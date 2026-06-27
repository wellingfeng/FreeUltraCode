import { describe, expect, it } from 'vitest';

import {
  RECALL_CLOSE,
  RECALL_INSTRUCTION,
  RECALL_OPEN,
  parseRecall,
  stripRecall,
} from './recallProtocol';

const block = (json: string) => `${RECALL_OPEN}\n${json}\n${RECALL_CLOSE}`;

describe('parseRecall', () => {
  it('returns null without the sentinel', () => {
    expect(parseRecall('normal reply')).toBeNull();
    expect(parseRecall('')).toBeNull();
  });

  it('parses a query', () => {
    expect(parseRecall(block('{"query":"资源导入"}'))).toEqual({ query: '资源导入' });
  });

  it('parses an optional limit', () => {
    expect(parseRecall(block('{"query":"x","limit":3}'))).toEqual({ query: 'x', limit: 3 });
  });

  it('rejects an empty query', () => {
    expect(parseRecall(block('{"query":"  "}'))).toBeNull();
  });

  it('ignores malformed JSON', () => {
    expect(parseRecall(`${RECALL_OPEN}\nnope\n${RECALL_CLOSE}`)).toBeNull();
  });

  it('ignores an unterminated block', () => {
    expect(parseRecall(`${RECALL_OPEN}\n{"query":"x"`)).toBeNull();
  });
});

describe('stripRecall', () => {
  it('removes the block and keeps prose', () => {
    const text = `先说点什么\n${block('{"query":"x"}')}\n后面`;
    const out = stripRecall(text);
    expect(out).toContain('先说点什么');
    expect(out).toContain('后面');
    expect(out).not.toContain(RECALL_OPEN);
  });

  it('drops everything from an unterminated block', () => {
    expect(stripRecall(`保留\n${RECALL_OPEN}\n{"query"`)).toBe('保留');
  });

  it('passes through text with no block', () => {
    expect(stripRecall('plain')).toBe('plain');
  });
});

describe('RECALL_INSTRUCTION', () => {
  it('starts with a separator and documents the sentinel', () => {
    expect(RECALL_INSTRUCTION.startsWith('\n\n')).toBe(true);
    expect(RECALL_INSTRUCTION).toContain('历史会话检索协议');
    expect(RECALL_INSTRUCTION).toContain(RECALL_OPEN);
  });
});
