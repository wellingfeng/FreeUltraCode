import { describe, it, expect } from 'vitest';
import { promoteStructureBreaks } from './promoteStructureBreaks';

describe('promoteStructureBreaks', () => {
  it('returns input unchanged when there is no newline', () => {
    expect(promoteStructureBreaks('plain text')).toBe('plain text');
  });

  it('promotes \\n before an ATX heading', () => {
    expect(promoteStructureBreaks('前文\n## 标题')).toBe('前文\n\n## 标题');
  });

  it('promotes \\n before a heading mid-chain without eating the next boundary', () => {
    expect(promoteStructureBreaks('a\n## b\n- c')).toBe('a\n\n## b\n\n- c');
  });

  it('promotes \\n before unordered list markers - * +', () => {
    expect(promoteStructureBreaks('a\n- x')).toBe('a\n\n- x');
    expect(promoteStructureBreaks('a\n* x')).toBe('a\n\n* x');
    expect(promoteStructureBreaks('a\n+ x')).toBe('a\n\n+ x');
  });

  it('promotes \\n before ordered list markers', () => {
    expect(promoteStructureBreaks('a\n1. x')).toBe('a\n\n1. x');
    expect(promoteStructureBreaks('a\n23) x')).toBe('a\n\n23) x');
  });

  it('promotes \\n before a table row that follows prose', () => {
    expect(promoteStructureBreaks('说明\n| c1 | c2 |')).toBe('说明\n\n| c1 | c2 |');
  });

  it('promotes \\n before a blockquote that follows prose', () => {
    expect(promoteStructureBreaks('a\n> 引用')).toBe('a\n\n> 引用');
  });

  it('promotes \\n before a --- divider (and *** and ___)', () => {
    expect(promoteStructureBreaks('a\n---\nb')).toBe('a\n\n---\nb');
    expect(promoteStructureBreaks('a\n***\nb')).toBe('a\n\n***\nb');
    expect(promoteStructureBreaks('a\n___\nb')).toBe('a\n\n___\nb');
  });

  it('accepts up to 3 leading spaces before the opener', () => {
    expect(promoteStructureBreaks('a\n  - x')).toBe('a\n\n  - x');
    expect(promoteStructureBreaks('a\n   ## t')).toBe('a\n\n   ## t');
  });

  it('does not promote 4-space indentation (indented code)', () => {
    expect(promoteStructureBreaks('a\n    - x')).toBe('a\n    - x');
  });

  it('is idempotent on already-blank-line markdown', () => {
    const md = '前文\n\n## 标题\n\n- 项一\n\n正文';
    expect(promoteStructureBreaks(md)).toBe(md);
  });

  it('does not turn an already-good \\n\\n into \\n\\n\\n', () => {
    const md = 'a\n\n## t';
    expect(promoteStructureBreaks(md)).toBe(md);
  });

  it('leaves plain soft-wrapped prose alone', () => {
    const md = '第一行\n第二行\n第三行';
    expect(promoteStructureBreaks(md)).toBe(md);
  });

  it('does not promote before a lone - (not a list marker without space)', () => {
    expect(promoteStructureBreaks('a\n-x')).toBe('a\n-x');
  });

  it('does not promote before # without a space (not a heading)', () => {
    expect(promoteStructureBreaks('a\n#tag')).toBe('a\n#tag');
  });

  it('keeps consecutive table rows in one block', () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    expect(promoteStructureBreaks(md)).toBe(md);
  });

  it('keeps consecutive list items in one block', () => {
    const md = '- a\n- b\n- c';
    expect(promoteStructureBreaks(md)).toBe(md);
  });

  it('keeps consecutive blockquote lines in one block', () => {
    const md = '> [!details] t\n>\n> - a\n> - b';
    expect(promoteStructureBreaks(md)).toBe(md);
  });

  it('still promotes when a table follows a list (different kinds)', () => {
    expect(promoteStructureBreaks('- a\n| t |')).toBe('- a\n\n| t |');
  });

  it('leaves newlines inside fenced code untouched', () => {
    const md = ['前文', '```', 'a\n## not a heading\n- not a list', '```', '后文'].join(
      '\n',
    );
    expect(promoteStructureBreaks(md)).toBe(md);
  });

  it('leaves newlines inside ~~~ fences untouched', () => {
    const md = ['前文', '~~~', 'x\n## no', '~~~'].join('\n');
    expect(promoteStructureBreaks(md)).toBe(md);
  });

  it('leaves newlines inside inline code untouched', () => {
    const md = '运行 `cmd\n--flag` 即可';
    expect(promoteStructureBreaks(md)).toBe(md);
  });

  it('still promotes around a stashed code fence (no leakage through mask)', () => {
    const md = ['前文', '```', 'code', '```', '## 标题'].join('\n');
    // The ``` line itself is not a structure opener, so the fence boundary
    // stays single-`\n`; the heading after the fence IS promoted.
    expect(promoteStructureBreaks(md)).toBe(
      ['前文', '```', 'code', '```', '', '## 标题'].join('\n'),
    );
  });

  it('handles the original deepseek wall-of-text shape end to end', () => {
    const md =
      '## 结论\nLSC 在移动端…缺的是「开门」。\n---\n## 根因链\n### 第 1 层\n`Config/DefaultEngine.ini:188`…';
    const out = promoteStructureBreaks(md);
    // Heading-body (`## x\n正文`) and heading-codespan (`### x\n`code``) are
    // legal CommonMark and stay. `---` after prose and `###` after `##` promote.
    expect(out).toBe(
      '## 结论\nLSC 在移动端…缺的是「开门」。\n\n---\n\n## 根因链\n\n### 第 1 层\n`Config/DefaultEngine.ini:188`…',
    );
  });

  it('does not promote a divider that trails prose on the same line', () => {
    const md = '前文\na --- b\n后文';
    expect(promoteStructureBreaks(md)).toBe(md);
  });

  it('does not promote a divider with trailing junk', () => {
    const md = '前文\n--- trailing\n后文';
    expect(promoteStructureBreaks(md)).toBe(md);
  });
});
