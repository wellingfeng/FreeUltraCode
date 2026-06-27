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
  '- 如果确实没有值得长期保存的内容，只回复"无"两个字，不要输出任何记忆块。这是合法且常见的结果。';

/** User prompt wrapping the transcript. */
export function buildReviewUserPrompt(transcript: string): string {
  return `以下是刚结束的对话记录，请审阅并按系统指令决定是否写入长期记忆：\n\n${transcript}`;
}
