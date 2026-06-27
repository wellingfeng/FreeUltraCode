import { describe, it, expect } from 'vitest';
import { convertInlineHtml } from './htmlInline';

describe('convertInlineHtml', () => {
  it('returns input unchanged when there is no tag', () => {
    const md = '核心魔法是 ReSTIR 基于蓄水池';
    expect(convertInlineHtml(md)).toBe(md);
  });

  it('converts <b>/<strong> to bold and <i>/<em> to italic', () => {
    expect(convertInlineHtml('核心是 <b>ReSTIR</b>')).toBe('核心是 **ReSTIR**');
    expect(convertInlineHtml('<strong>X</strong>')).toBe('**X**');
    expect(convertInlineHtml('<i>y</i>')).toBe('*y*');
    expect(convertInlineHtml('<em>z</em>')).toBe('*z*');
  });

  it('handles sloppy close tags with inner whitespace and attributes', () => {
    expect(convertInlineHtml('A <b class="x">hi< / b > B')).toBe('A **hi** B');
  });

  it('strips closing tags so a bare </b> never leaks a /b file chip', () => {
    const out = convertInlineHtml('ReSTIR</b> 光追阴影</b>');
    expect(out).toBe('ReSTIR 光追阴影');
    expect(out).not.toContain('/b');
  });

  it('converts <br> to a newline', () => {
    expect(convertInlineHtml('a<br>b')).toBe('a\nb');
    expect(convertInlineHtml('a<br/>b')).toBe('a\nb');
  });

  it('unwraps drop-only tags like <u> and <span>', () => {
    expect(convertInlineHtml('<u>x</u> <span>y</span>')).toBe('x y');
  });

  it('leaves tags inside inline code untouched', () => {
    const md = 'use `<b>literal</b>` here';
    expect(convertInlineHtml(md)).toBe(md);
  });

  it('leaves tags inside fenced code untouched', () => {
    const md = ['```html', '<b>literal</b>', '```'].join('\n');
    expect(convertInlineHtml(md)).toBe(md);
  });
});
