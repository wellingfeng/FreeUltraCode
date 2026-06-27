import { describe, expect, it } from 'vitest';

import {
  MEMORY_CLOSE,
  MEMORY_OPEN,
  MEMORY_WRITE_INSTRUCTION,
  parseMemoryWrites,
  stripMemoryWrites,
} from './memoryProtocol';

function block(json: string): string {
  return `${MEMORY_OPEN}\n${json}\n${MEMORY_CLOSE}`;
}

describe('parseMemoryWrites', () => {
  it('returns empty array when no sentinel present', () => {
    expect(parseMemoryWrites('just a normal reply')).toEqual([]);
    expect(parseMemoryWrites('')).toEqual([]);
  });

  it('parses an operations batch for a target', () => {
    const text =
      '好的，我记下来了。' +
      block('{"target":"user","operations":[{"action":"add","content":"偏好 Unity"}]}');
    const reqs = parseMemoryWrites(text);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].target).toBe('user');
    expect(reqs[0].operations).toEqual([{ action: 'add', content: '偏好 Unity' }]);
  });

  it('accepts a single inline op without operations array', () => {
    const reqs = parseMemoryWrites(block('{"target":"memory","action":"add","content":"引擎=Godot"}'));
    expect(reqs[0].operations).toEqual([{ action: 'add', content: '引擎=Godot' }]);
  });

  it('accepts snake_case old_text and maps to oldText', () => {
    const reqs = parseMemoryWrites(
      block('{"target":"memory","operations":[{"action":"remove","old_text":"陈旧"}]}'),
    );
    expect(reqs[0].operations[0]).toEqual({ action: 'remove', oldText: '陈旧' });
  });

  it('parses multiple blocks into multiple requests', () => {
    const text =
      block('{"target":"user","operations":[{"action":"add","content":"a"}]}') +
      '\n中间一些文字\n' +
      block('{"target":"memory","operations":[{"action":"add","content":"b"}]}');
    const reqs = parseMemoryWrites(text);
    expect(reqs.map((r) => r.target)).toEqual(['user', 'memory']);
  });

  it('rejects an invalid target', () => {
    expect(parseMemoryWrites(block('{"target":"nope","operations":[{"action":"add","content":"x"}]}'))).toEqual([]);
  });

  it('rejects a block with no valid operations', () => {
    expect(parseMemoryWrites(block('{"target":"user","operations":[{"action":"frob"}]}'))).toEqual([]);
  });

  it('ignores malformed JSON inside the block', () => {
    expect(parseMemoryWrites(`${MEMORY_OPEN}\nnot json\n${MEMORY_CLOSE}`)).toEqual([]);
  });
});

describe('stripMemoryWrites', () => {
  it('removes the block and keeps surrounding prose', () => {
    const text = `前面的话\n${block('{"target":"user","operations":[{"action":"add","content":"x"}]}')}\n后面的话`;
    const stripped = stripMemoryWrites(text);
    expect(stripped).toContain('前面的话');
    expect(stripped).toContain('后面的话');
    expect(stripped).not.toContain(MEMORY_OPEN);
  });

  it('removes multiple blocks', () => {
    const text =
      block('{"target":"user","operations":[{"action":"add","content":"a"}]}') +
      'middle' +
      block('{"target":"memory","operations":[{"action":"add","content":"b"}]}');
    expect(stripMemoryWrites(text)).toBe('middle');
  });

  it('drops everything from an unterminated block onward', () => {
    const text = `保留这句\n${MEMORY_OPEN}\n{"target":"user"`;
    expect(stripMemoryWrites(text)).toBe('保留这句');
  });

  it('returns text unchanged when no block present', () => {
    expect(stripMemoryWrites('plain text')).toBe('plain text');
  });
});

describe('MEMORY_WRITE_INSTRUCTION', () => {
  it('starts with a blank-line separator and names both targets', () => {
    expect(MEMORY_WRITE_INSTRUCTION.startsWith('\n\n')).toBe(true);
    expect(MEMORY_WRITE_INSTRUCTION).toContain('长期记忆写入协议');
    expect(MEMORY_WRITE_INSTRUCTION).toContain(MEMORY_OPEN);
    expect(MEMORY_WRITE_INSTRUCTION).toContain('不要写');
  });
});
