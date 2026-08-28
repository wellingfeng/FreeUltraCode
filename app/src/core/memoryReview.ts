/**
 * CONTRACT: background self-review for long-term memory (the closed learning
 * loop, mirrored from Hermes).
 *
 * After a qualifying chat turn, the app may fork a cheap, fire-and-forget model
 * call that replays the turn's transcript and asks "what durable memory should
 * be saved?". The review emits the SAME <<UGS_MEMORY>> blocks the foreground
 * protocol uses, which the caller parses and applies. The main conversation and
 * its prompt are never touched.
 *
 * This module is pure (no IO/React/store/model call). It owns: the gating
 * decision (rate limit + signal gate), the transcript builder, and the review
 * system/user prompts. The caller owns the actual model invocation and the
 * timestamp persistence.
 *
 * Cost note: review spends model quota autonomously, so it is OFF by default
 * and the caller must rate-limit via shouldRunReview() before invoking.
 */

import { MEMORY_OPEN, MEMORY_CLOSE } from './memoryProtocol';

export interface ReviewGateConfig {
  reviewEnabled: boolean;
  reviewMinMessages: number;
  reviewMinIntervalMinutes: number;
}

export interface ReviewTurnMessage {
  role: string;
  text: string;
}

/**
 * Decide whether a background review should run for this turn. Pure: the caller
 * passes the persisted last-run timestamp and the current message count.
 */
export function shouldRunReview(
  config: ReviewGateConfig,
  lastRunAt: number,
  messageCount: number,
  now: number = Date.now(),
): boolean {
  if (!config.reviewEnabled) return false;
  if (messageCount < config.reviewMinMessages) return false;
  const minIntervalMs = config.reviewMinIntervalMinutes * 60_000;
  if (minIntervalMs > 0 && now - lastRunAt < minIntervalMs) return false;
  return true;
}

/** Fold a turn transcript into a bounded plain-text block for the review. */
export function buildReviewTranscript(
  messages: ReviewTurnMessage[],
  maxChars = 6000,
): string {
  const lines = messages
    .filter((m) => m.text && m.text.trim())
    .map((m) => {
      const who = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : m.role;
      return `${who}：${m.text.trim()}`;
    });
  let transcript = lines.join('\n\n');
  if (transcript.length > maxChars) {
    // Keep the tail — the most recent exchange carries the freshest signal.
    transcript = `…（已截断较早内容）\n\n${transcript.slice(transcript.length - maxChars)}`;
  }
  return transcript;
}

/** System prompt for the review fork. Includes the same "do NOT record" rules. */
export const REVIEW_SYSTEM =
  '你是一个"记忆审阅员"。下面会给你一段刚结束的对话记录。你的唯一任务：判断其中有没有"跨会话仍然有用"的稳定事实值得写入长期记忆。' +
  '不要回答对话里的问题，不要复述对话，不要寒暄。\n\n' +
  '若值得写入，按下面格式输出一个或多个记忆块（可针对 user / memory 两个库）：\n' +
  `${MEMORY_OPEN}\n` +
  '{"target":"user","operations":[{"action":"add","content":"一句话事实"}]}\n' +
  `${MEMORY_CLOSE}\n` +
  '- target：user=关于用户是谁（称呼、角色、偏好、沟通风格、常用引擎）；memory=助手笔记（当前项目引擎、资源约定、工具怪癖、踩过的坑）。\n' +
  '- 优先级：用户偏好与纠正 > 环境事实 > 流程。\n' +
  '- 不要写（会变成日后反噬的自我约束）：环境型失败（缺二进制、命令找不到、未装依赖、未配置凭据）；对工具/功能的负面断言；会话内已解决的临时错误；一次性任务叙述；琐碎可重新发现的信息。\n' +
  '- 条目要短、信息密度高。\n' +
  '- 若用户消息里给出了"当前记忆库快照"：写入前先看它。当该库已接近/超过字数上限，或已有条目与新事实重复、重叠、已过时，必须先用 replace 把重复/重叠条目合并成更短的一句、用 remove 删掉过时或不重要的条目，再 add——不要只 add 导致超限被拒。oldText 用已有条目里的一段唯一子串。合并时保留关键事实，不丢重要信息。\n' +
  '- 如果确实没有值得长期保存的内容，只回复"无"两个字，不要输出任何记忆块。这是合法且常见的结果。';

/**
 * Render the current entries of one memory store into a block the review model
 * reads before proposing writes. Giving it the live inventory is what lets it
 * consolidate (merge overlapping / drop stale) instead of only `add`-ing until
 * the char limit rejects every write — the same "return current entries on
 * overflow" affordance Hermes' memory tool gives the agent mid-turn.
 */
export interface ReviewMemoryContext {
  /** Human label, e.g. "用户画像（全局）" / "助手笔记（本项目）". */
  label: string;
  /** Current entry texts in order. */
  entries: string[];
  /** Current char usage vs limit. */
  used: number;
  limit: number;
}

export function formatReviewMemoryContext(ctx: ReviewMemoryContext): string {
  if (!ctx.entries.length) return '';
  const pct = ctx.limit > 0 ? Math.round((ctx.used / ctx.limit) * 100) : 0;
  const over = ctx.limit > 0 && ctx.used >= ctx.limit;
  const hot = !over && pct >= 85;
  const status = over
    ? `已用 ${ctx.used}/${ctx.limit} 字，已超上限`
    : hot
      ? `已用 ${ctx.used}/${ctx.limit} 字（${pct}%），接近上限`
      : `已用 ${ctx.used}/${ctx.limit} 字（${pct}%）`;
  const lines = ctx.entries.map((e) => `- ${e}`);
  return (
    `【当前记忆库快照】${ctx.label}：${status}。已有条目：\n${lines.join('\n')}\n` +
    '写入时若与上列条目重复/重叠/过时，优先 replace 合并、remove 删除来腾出空间，再 add。'
  );
}

/** User prompt wrapping the transcript, optionally carrying current-store snapshots. */
export function buildReviewUserPrompt(
  transcript: string,
  memoryContexts: string[] = [],
): string {
  const blocks = memoryContexts.filter((s) => s && s.trim());
  const memorySection = blocks.length ? `\n\n${blocks.join('\n\n')}` : '';
  return `以下是刚结束的对话记录，请审阅并按系统指令决定是否写入长期记忆：\n\n${transcript}${memorySection}`;
}

/**
 * Cap on how many times the review model may retry a rejected write before we
 * give up. Mirrors Hermes' hard 3-attempt limit on its memory tool — it refuses
 * to write on overflow, feeds back the current entries, and lets the model
 * consolidate (remove/replace) then retry, but never loops forever.
 */
export const MAX_CONSOLIDATE_RETRIES = 3;

/** The details of one rejected batch, fed back to the model on retry. */
export interface ConsolidateFeedbackInput {
  target: 'user' | 'memory';
  error: string;
  entries: string[];
  used: number;
  limit: number;
}

/**
 * Render a rejected batch into a directive telling the review model to
 * consolidate and retry in the same turn. This is the programmatic half of
 * Hermes' "overflow → refuse → echo current entries → ask to merge" loop; the
 * model still decides WHAT to drop/merge, we never silently discard anything.
 */
export function buildConsolidateFeedback(input: ConsolidateFeedbackInput): string {
  const label = input.target === 'user' ? '用户画像（全局）' : '助手笔记（本项目）';
  const list = input.entries.length
    ? input.entries.map((e) => `- ${e}`).join('\n')
    : '（空）';
  return (
    `【上一轮写入被拒】你对「${label}」的写入未生效，原因：${input.error}。\n` +
    `该库当前共 ${input.entries.length} 条、${input.used}/${input.limit} 字，内容如下：\n${list}\n` +
    '请重新输出记忆块：先用 remove 删掉过时/不重要的条目、用 replace 把重复/重叠条目合并成更短的一句，腾出空间后再 add。oldText 必须用上面某条里的唯一子串。'
  );
}

/** Re-wrap the transcript + rejection feedback so the model can retry in a fresh call. */
export function buildConsolidateRetryPrompt(
  transcript: string,
  feedbackBlocks: string[],
): string {
  const blocks = feedbackBlocks.filter((s) => s && s.trim());
  const section = blocks.length ? `\n\n${blocks.join('\n\n')}` : '';
  return `你上一次写入有一部分被拒绝，请按系统指令修正后重新输出：\n\n${transcript}${section}`;
}
