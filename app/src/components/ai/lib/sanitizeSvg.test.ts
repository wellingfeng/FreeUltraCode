import { describe, it, expect } from 'vitest';
import { sanitizeSvg } from './sanitizeSvg';

describe('sanitizeSvg', () => {
  it('returns null for empty / non-svg input', () => {
    expect(sanitizeSvg('')).toBeNull();
    expect(sanitizeSvg('<div>not svg</div>')).toBeNull();
    expect(sanitizeSvg('<svg><rect')).toBeNull(); // malformed
  });

  it('strips <script> and on* handlers', () => {
    const src = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect onclick="alert(2)" width="10" height="10"/></svg>`;
    const out = sanitizeSvg(src)!;
    expect(out).not.toContain('script');
    expect(out).not.toContain('onclick');
    expect(out).toContain('<rect');
  });

  it('drops javascript: URLs but keeps safe hrefs', () => {
    const src = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="javascript:alert(1)"><rect width="10" height="10"/></a><image href="data:image/png;base64,AAAA"/></svg>`;
    const out = sanitizeSvg(src)!;
    expect(out).not.toContain('javascript:');
    expect(out).toContain('data:image/png');
  });

  it('removes foreignObject', () => {
    const src = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>x</div></foreignObject><rect width="10" height="10"/></svg>`;
    const out = sanitizeSvg(src)!;
    expect(out).not.toContain('foreignObject');
  });

  it('preserves <use> + <symbol> references', () => {
    const src = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><symbol id="s"><rect width="5" height="5"/></symbol></defs><use xlink:href="#s" x="1" y="1"/></svg>`;
    const out = sanitizeSvg(src)!;
    expect(out).toContain('symbol');
    expect(out).toContain('use');
    expect(out).toContain('#s');
  });
});
