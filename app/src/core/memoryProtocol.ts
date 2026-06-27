/**
 * CONTRACT: model-agnostic "save to long-term memory" protocol.
 *
 * Like the interaction protocol (see core/interaction.ts), a chat turn is a
 * one-shot CLI/API call that can't invoke provider-specific tools mid-stream.
 * So we impose ONE convention on every model: to persist a durable fact, emit a
 * delimited JSON block anywhere in its reply (typically at the very end):
 *
 *     <<UGS_MEMORY>>
 *     { "target": "user", "operations": [ { "action": "add", "content": "偏好 Unity" } ] }
 *     <<UGS_MEMORY_END>>
 *
 * After the turn completes the run loop parses the block, applies it to the
 * on-disk store (lib/memoryStore.ts), and strips it from the visible message.
 * The write lands on the NEXT turn's frozen system-prompt snapshot — it does
 * NOT mutate the current turn's prompt, preserving the native-CLI prefix cache.
 *
 * This module is pure (no IO, no React, no store). It owns: the sentinels, the
 * op/target types, the tolerant parse/strip helpers, and the instruction text
 * injected into the chat system prompt.
 */

export type MemoryTarget = 'memory' | 'user';

export interface MemoryOp {
  action: 'add' | 'replace' | 'remove';
  content?: string;
  /** A short unique substring identifying the entry for replace/remove. */
  oldText?: string;
}

/** A parsed memory-write request: a batch of ops against one target store. */
export interface MemoryWriteRequest {
  target: MemoryTarget;
  operations: MemoryOp[];
}

export const MEMORY_OPEN = '<<UGS_MEMORY>>';
export const MEMORY_CLOSE = '<<UGS_MEMORY_END>>';

/** Extract the first balanced top-level JSON object substring, or null. */
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

function normalizeOp(raw: unknown): MemoryOp | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const action = obj.action;
  if (action !== 'add' && action !== 'replace' && action !== 'remove') return null;
  const op: MemoryOp = { action };
  if (typeof obj.content === 'string') op.content = obj.content;
  // Accept both camelCase (oldText) and snake_case (old_text) from models.
  const old = obj.oldText ?? obj.old_text;
  if (typeof old === 'string') op.oldText = old;
  return op;
}

/**
 * Parse a turn's output for ALL memory-write blocks. Keyed strictly on the
 * `<<UGS_MEMORY>>` sentinel so ordinary JSON in a reply never false-positives.
 * Returns one request per valid block (multiple blocks → multiple requests),
 * or an empty array when none are present.
 */
export function parseMemoryWrites(text: string): MemoryWriteRequest[] {
  if (!text || !text.includes(MEMORY_OPEN)) return [];
  const out: MemoryWriteRequest[] = [];
  let cursor = 0;
  for (;;) {
    const open = text.indexOf(MEMORY_OPEN, cursor);
    if (open === -1) break;
    const afterOpen = text.slice(open + MEMORY_OPEN.length);
    const close = afterOpen.indexOf(MEMORY_CLOSE);
    if (close === -1) break;
    const body = afterOpen.slice(0, close);
    cursor = open + MEMORY_OPEN.length + close + MEMORY_CLOSE.length;

    const span = firstJsonObject(body);
    if (!span) continue;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(span) as Record<string, unknown>;
    } catch {
      continue;
    }
    const target = raw.target === 'user' ? 'user' : raw.target === 'memory' ? 'memory' : null;
    if (!target) continue;

    // Accept either an `operations` array or a single inline op.
    let ops: MemoryOp[] = [];
    if (Array.isArray(raw.operations)) {
      ops = raw.operations.map(normalizeOp).filter((o): o is MemoryOp => o !== null);
    } else {
      const single = normalizeOp(raw);
      if (single) ops = [single];
    }
    if (ops.length === 0) continue;
    out.push({ target, operations: ops });
  }
  return out;
}

/** Remove every memory-write block from the text so it isn't shown to the user. */
export function stripMemoryWrites(text: string): string {
  if (!text || !text.includes(MEMORY_OPEN)) return text;
  let result = '';
  let cursor = 0;
  for (;;) {
    const open = text.indexOf(MEMORY_OPEN, cursor);
    if (open === -1) {
      result += text.slice(cursor);
      break;
    }
    result += text.slice(cursor, open);
    const afterOpen = text.slice(open + MEMORY_OPEN.length);
    const close = afterOpen.indexOf(MEMORY_CLOSE);
    if (close === -1) {
      // Unterminated block: drop everything from the sentinel onward.
      break;
    }
    cursor = open + MEMORY_OPEN.length + close + MEMORY_CLOSE.length;
  }
  return result.trim();
}

/**
 * The instruction block injected into the chat system prompt teaching the model
 * when and how to write durable memory. Mirrors Hermes' guidance, including the
 * critical "do NOT record" list that prevents environment-specific failures
 * from hardening into permanent self-imposed constraints. Begins with "\n\n" so
 * it concatenates cleanly onto the rest of the system prompt.
 */
export const MEMORY_WRITE_INSTRUCTION =
  '\n\n【长期记忆写入协议】你可以把"跨会话仍然有用"的稳定事实写入长期记忆。' +
  '需要写入时，在回复的末尾输出一个记忆块（用户看不到它，会被自动剥离），然后正常结束：\n' +
  `${MEMORY_OPEN}\n` +
  '{"target":"user","operations":[{"action":"add","content":"简短的一条事实"}]}\n' +
  `${MEMORY_CLOSE}\n` +
  '- target：`user`=关于用户是谁（称呼、角色、偏好、沟通风格、常用引擎）；`memory`=你的笔记（当前项目引擎判读结果、资源目录约定、工具链怪癖、踩过的坑）。\n' +
  '- operations：原子批量执行，只在最终结果校验字数上限，所以同一个块里可以先 remove/replace 腾出空间再 add。action ∈ add|replace|remove；replace/remove 需要 oldText（已有条目的一段唯一子串）。\n' +
  '- 何时写：用户表达偏好/纠正/个人信息，或你确认了关于其环境、约定、工作流的稳定事实时，主动写。优先级：用户偏好与纠正 > 环境事实 > 流程。最好的记忆能让用户不必重复自己。\n' +
  '- 不要写（这些会变成日后反噬你的"自我强加约束"）：环境型失败（缺二进制、命令找不到、未装依赖、未配置凭据）；对工具/功能的负面断言（"X 工具坏了""无法用 Y"）；会话内已解决的临时错误；一次性任务叙述；琐碎或可随时重新发现的信息。\n' +
  '- 条目要短、信息密度高。每条一句话。无需写入时不要输出记忆块。';
