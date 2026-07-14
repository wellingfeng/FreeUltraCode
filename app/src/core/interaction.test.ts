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
