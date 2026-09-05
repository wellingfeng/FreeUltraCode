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

/**
 * Two-stage transcript (Hermes' summary-replay): instead of dropping the
 * overflow head entirely, split into the part that fits and the part that
 * must be compressed first. The caller asks a (cheap) model to digest the
 * overflow into ≤ digestMaxChars of dense facts, then reviews
 * `digest + tail` — so mid-conversation facts survive instead of being cut.
 * Returns null when nothing overflows (single-stage review is fine).
 */
export interface TranscriptOverflow {
  /** The overflow head to be summarized by the caller. */
  overflow: string;
  /** The tail that fits `maxChars` (reviewed verbatim). */
  tail: string;
}

/** Max fraction of `maxChars` the digest itself may occupy. */
export const DIGEST_MAX_RATIO = 0.25;

export function splitTranscriptForDigest(
  messages: ReviewTurnMessage[],
  maxChars = 6000,
): TranscriptOverflow | null {
  const lines = messages
    .filter((m) => m.text && m.text.trim())
    .map((m) => {
      const who = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : m.role;
      return `${who}：${m.text.trim()}`;
    });
  const full = lines.join('\n\n');
  if (full.length <= maxChars) return null;
  const keep = Math.max(0, maxChars - 1); // room for the '\n' separator
  const tail = full.slice(full.length - keep);
  const cut = full.length - keep;
  return { overflow: full.slice(0, cut), tail };
}

/** System prompt for the digest stage (a cheap fast model call). */
export const DIGEST_SYSTEM =
  '你是对话摘要器。把这段对话压缩成一份事实清单，供后续"长期记忆审阅"使用。' +
  '只保留持久性事实（用户身份/偏好/纠正、环境与项目约定、工具链与流程要点、明确结论），' +
  '丢弃寒暄、过程叙述和一次性细节。用短行列出，总长不超过指定字数。不要评论，不要寒暄。';

/** User prompt for the digest stage. */
export function buildDigestUserPrompt(overflow: string, digestMaxChars: number): string {
  return `请把以下对话压缩为不超过 ${digestMaxChars} 字的事实清单：\n\n${overflow}`;
}

/** Assemble the final review transcript from digest + tail. */
export function joinDigestAndTail(digest: string, tail: string): string {
  const d = digest.trim();
  return d ? `（较早对话摘要）\n${d}\n\n（近期对话原文）\n${tail}` : tail;
}

/** System prompt for the review fork. Includes the same "do NOT record" rules. */
export const REVIEW_SYSTEM =
  '你是一个"记忆审阅员"，标准严格。下面会给你一段刚结束的对话记录。你的唯一任务：判断其中有没有"跨会话仍然有用"的稳定事实值得写入长期记忆。' +
  '不要回答对话里的问题，不要复述对话，不要寒暄。\n\n' +
  '若值得写入，按下面格式输出一个或多个记忆块（可针对 user / memory 两个库）：\n' +
  `${MEMORY_OPEN}\n` +
  '{"target":"user","operations":[{"action":"add","content":"一句话事实","importance":"important"}]}\n' +
  `${MEMORY_CLOSE}\n` +
  '- target：user=关于用户是谁（称呼、角色、偏好、沟通风格、常用引擎）；memory=助手笔记（当前项目引擎、资源约定、工具怪癖、踩过的坑）。\n' +
  '- importance（必填）：must=用户明确纠正/硬性偏好/会导致返工的约定；important=默认（环境、引擎、工作流等稳定事实）；minor=锦上添花的细节，可被最先淘汰。中英文均可（必须/重要/不重要）。\n' +
  '- 优先级：用户偏好与纠正 > 环境事实 > 流程。\n' +
  '- 默认倾向不写。绝大多数对话没有任何值得长期保存的内容，"无"是合法且常见的回答。\n' +
  '- 不要写（会变成日后反噬的自我约束）：环境型失败（缺二进制、命令找不到、未装依赖、未配置凭据）；对工具/功能的负面断言；会话内已解决的临时错误；一次性任务叙述；过程流水账；琐碎可重新发现的信息（单一命令片段、单个参数名、可从代码或 git 历史随手查到的事实）。\n' +
  '- 一条记忆必须同时满足：具体可执行（一个月后看到仍知道怎么做）+ 信息密度高（一句话说清一个事实）+ 跨会话有用。三个条件缺一即不写。\n' +
  '- 条目要短、信息密度高。\n' +
  '- 若用户消息里给出了"当前记忆库快照"：写入前先看它。当该库已接近/超过字数上限，或已有条目与新事实重复、重叠、已过时，必须先用 replace 把重复/重叠条目合并成更短的一句、用 remove 删掉过时或不重要的条目，腾出空间后再 add——不要只 add 导致超限被拒。oldText 用已有条目里的一段唯一子串。合并时保留关键事实，不丢重要信息。\n' +
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
  /** Current entries in order, with their AI-suggested importance tier (if any). */
  entries: { text: string; importance?: string }[];
  /** Current char usage vs limit. */
  used: number;
  limit: number;
}

/** Short human/model-readable marker for one entry's importance tier. */
function importanceMarker(importance?: string): string {
  switch ((importance ?? '').trim().toLowerCase()) {
    case 'must':
    case '必须':
      return '[必须]';
    case 'minor':
    case '不重要':
      return '[不重要]';
    case 'important':
    case '重要':
      return '[重要]';
    default:
      return '[未标记]';
  }
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
  const lines = ctx.entries.map((e) => `- ${importanceMarker(e.importance)} ${e.text}`);
  return (
    `【当前记忆库快照】${ctx.label}：${status}。已有条目（[必须]/[重要]/[不重要]=AI 建议重要度，[未标记]=尚未评级）：\n${lines.join('\n')}\n` +
    '写入时若与上列条目重复/重叠/过时，优先 replace 合并、remove 删除来腾出空间，再 add。replace 合并旧条目时必须带 importance 重新评级；不要改动未触碰条目的内容。'
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
