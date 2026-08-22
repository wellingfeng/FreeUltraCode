import { describe, it, expect } from 'vitest';
import { parseInteraction, stripInteraction, liveProse } from './interaction';

// Regression: models frequently fumble the opening sentinel — a dropped `>`
// (`<<UGS_ASK>`), an extra one (`<<UGS_ASK>>>`), or stray whitespace. The strict
// `indexOf('<<UGS_ASK>>')` used to miss those, leaking raw protocol JSON into the
// chat bubble and rendering no interaction widget.
describe('tolerant UGS_ASK sentinel matching', () => {
  const cases: Array<[string, string]> = [
    ['single >', '<<UGS_ASK>'],
    ['triple >', '<<UGS_ASK>>>'],
    ['inner spaces', '<< UGS_ASK >>'],
  ];

  for (const [name, open] of cases) {
    const text = `前言正文。\n\n${open}\n{"type":"confirm","prompt":"要改名吗？","confirmLabel":"改","cancelLabel":"先别动"}\n<<UGS_ASK_END>>`;

    it(`parses a confirm request with a ${name} open sentinel`, () => {
      const req = parseInteraction(text);
      expect(req).not.toBeNull();
      expect(req!.type).toBe('confirm');
      expect(req!.prompt).toBe('要改名吗？');
    });

    it(`strips the block for a ${name} open sentinel`, () => {
      expect(stripInteraction(text)).toBe('前言正文。');
    });

    it(`liveProse cuts at a ${name} open sentinel`, () => {
      expect(liveProse(text)).toBe('前言正文。');
    });
  }

  it('still requires a closing sentinel (unterminated block is not a request)', () => {
    const text = `前言。\n\n<<UGS_ASK>\n{"type":"confirm","prompt":"要改名吗？"}`;
    expect(parseInteraction(text)).toBeNull();
  });
});

// Root-cause regression: `liveProse` used to scan the whole stream for the first
// ``` and cut there. Tool-result sentinels (`<<UGS_TOOL>>…<<UGS_TOOL_END>>`)
// routinely contain literal backticks (markdown files, diffs, compile logs), so
// the live bubble got truncated at the first tool result and only refreshed at
// round end ("stream frozen, then a sudden full refresh").
describe('liveProse tool-sentinel fence handling', () => {
  const toolBlock =
    `<<UGS_TOOL>>${JSON.stringify({
      id: 't1',
      name: 'Read',
      subject: 'README.md',
      status: 'done',
      result: '\n```\n# 标题\n```\n',
    })}<<UGS_TOOL_END>>`;

  it('does not cut inside a tool sentinel payload that contains ```', () => {
    const text = `好的，我先读取这个文件。\n${toolBlock}\n文件读完了，接下来开始编译。`;
    const out = liveProse(text);
    expect(out).toBe(text);
    expect(out).toContain('文件读完了，接下来开始编译。');
  });

  it('does not cut inside an unterminated tool payload that contains ```', () => {
    const text = '开头。\n<<UGS_TOOL>>{"id":"t1","result":"\n```\n半截载荷';
    const out = liveProse(text);
    expect(out).toBe(text.trimEnd());
  });

  it('still cuts at a real fence in prose (blueprint flow regression guard)', () => {
    const text = '先看说明。\n```json\n{"a":1}\n```\n后面还有正文';
    expect(liveProse(text)).toBe('先看说明。');
  });

  it('cutAtFence=false keeps real code fences visible (plain chat)', () => {
    const text = '先看说明。\n```ts\nconst x = 1;\n```\n后面还有正文';
    expect(liveProse(text, false)).toBe(text.trimEnd());
  });
});
