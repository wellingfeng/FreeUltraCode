import { afterEach, describe, expect, it, vi } from 'vitest';
import { downscalePastedImage } from './pastedImage';

function makeFile(bytes: number, type = 'image/png', name = 'shot.png'): File {
  const file = new File([new Uint8Array(bytes)], name, { type });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('downscalePastedImage', () => {
  it('returns non-image files untouched', async () => {
    const file = makeFile(5_000_000, 'application/pdf', 'a.pdf');
    expect(await downscalePastedImage(file)).toBe(file);
  });

  it('never rasterizes animated gif or svg', async () => {
    const gif = makeFile(5_000_000, 'image/gif', 'a.gif');
    const svg = makeFile(5_000_000, 'image/svg+xml', 'a.svg');
    expect(await downscalePastedImage(gif)).toBe(gif);
    expect(await downscalePastedImage(svg)).toBe(svg);
  });

  it('leaves small images alone', async () => {
    const file = makeFile(50_000);
    expect(await downscalePastedImage(file)).toBe(file);
  });

  it('falls back to the original file when canvas APIs are missing', async () => {
    // jsdom has no createImageBitmap; a big file should pass through unchanged.
    const file = makeFile(2_000_000);
    expect(typeof createImageBitmap).not.toBe('function');
    expect(await downscalePastedImage(file)).toBe(file);
  });

  it('downscales a large image when the browser can rasterize it', async () => {
    const bitmap = {
      width: 4000,
      height: 3000,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));

    const smallBlob = new Blob([new Uint8Array(120_000)], { type: 'image/jpeg' });
    Object.defineProperty(smallBlob, 'size', { value: 120_000 });
    const ctx = { drawImage: vi.fn() };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
      toBlob: (cb: (b: Blob | null) => void) => cb(smallBlob),
    };
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? canvas : document.createElement(tag)) as typeof document.createElement);

    const file = makeFile(1_500_000);
    const out = await downscalePastedImage(file);
    expect(out).not.toBe(file);
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('shot.jpg');
    // 4000px long edge scaled to the 1568 ceiling.
    expect(canvas.width).toBe(1568);
    expect(canvas.height).toBe(1176);
    expect(out.size).toBeLessThan(file.size);
  });
});
