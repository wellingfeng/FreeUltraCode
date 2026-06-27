/**
 * CONTRACT: model-agnostic "search my past conversations" protocol.
 *
 * Like the interaction and memory protocols, a chat turn is a one-shot call.
 * To let the model pull in relevant history mid-turn we impose one convention:
 * it emits a delimited request and ends its turn:
 *
 *     <<UGS_RECALL>>
 *     { "query": "我们上次怎么处理资源导入的" }
 *     <<UGS_RECALL_END>>
 *
 * The run loop parses it, searches the history store (lib/sessionSearch.ts),
 * feeds the formatted hits back as a continuation, and re-invokes the model in
 * the same bounded loop used for interaction round-trips. No backend/SQLite
 * changes — search runs over already-persisted session JSON.
 *
 * This module is pure (no IO/React/store): sentinels, the request type, and the
 * tolerant parse/strip helpers plus the system-prompt instruction text.
 */

export interface RecallRequest {
  query: string;
  /** Optional cap on how many sessions to return (clamped by the caller). */
  limit?: number;
}

export const RECALL_OPEN = '<<UGS_RECALL>>';
export const RECALL_CLOSE = '<<UGS_RECALL_END>>';

function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Parse the FIRST recall request in the text, or null when none is present. */
export function parseRecall(text: string): RecallRequest | null {
  if (!text || !text.includes(RECALL_OPEN)) return null;
  const open = text.indexOf(RECALL_OPEN);
  const afterOpen = text.slice(open + RECALL_OPEN.length);
  const close = afterOpen.indexOf(RECALL_CLOSE);
  if (close === -1) return null;
  const span = firstJsonObject(afterOpen.slice(0, close));
  if (!span) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(span) as Record<string, unknown>;
  } catch {
    return null;
  }
  const query = typeof raw.query === 'string' ? raw.query.trim() : '';
  if (!query) return null;
  const limit =
    typeof raw.limit === 'number' && Number.isFinite(raw.limit)
      ? Math.max(1, Math.floor(raw.limit))
      : undefined;
  return limit === undefined ? { query } : { query, limit };
}

/** Remove the recall block(s) so the protocol JSON is never shown to the user. */
export function stripRecall(text: string): string {
  if (!text || !text.includes(RECALL_OPEN)) return text;
  let result = '';
  let cursor = 0;
  for (;;) {
    const open = text.indexOf(RECALL_OPEN, cursor);
    if (open === -1) {
      result += text.slice(cursor);
      break;
    }
    result += text.slice(cursor, open);
    const afterOpen = text.slice(open + RECALL_OPEN.length);
    const close = afterOpen.indexOf(RECALL_CLOSE);
    if (close === -1) break;
    cursor = open + RECALL_OPEN.length + close + RECALL_CLOSE.length;
  }
  return result.trim();
}

/**
 * Instruction injected into the chat system prompt. Begins with "\n\n" so it
 * concatenates cleanly. Teaches the model to recall past conversations on
 * demand instead of asking the user to repeat themselves.
 */
export const RECALL_INSTRUCTION =
  '\n\n【历史会话检索协议】当用户提到"上次/之前/我们讨论过/还记得吗"之类，需要回忆早先对话，但当前上下文里没有相关内容时，' +
  '在回复中输出一个检索块然后结束本回合（用户看不到它）：\n' +
  `${RECALL_OPEN}\n` +
  '{"query":"要检索的关键词或问题"}\n' +
  `${RECALL_CLOSE}\n` +
  '系统会在本项目的历史会话中检索，并把命中的标题、片段与上下文回传给你；你拿到结果后再正常作答。\n' +
  '- 只在确有需要回忆早先信息、且当前对话里找不到时才检索；普通问题直接回答，不要滥用。\n' +
  '- 一轮最多发起一次检索；拿到结果若仍不够，可再发起一次，但不要反复空转。';
