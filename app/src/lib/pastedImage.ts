// Client-side downscaling for pasted screenshots.
//
// Pasted screenshots are frequently full-resolution PNGs (1–4 MB). Sent raw, a
// single image inlines as base64 into the model request body and can blow past
// the context limit (upstream returns HTTP 400 REQUEST_BODY_INVALID). We
// downscale the long edge to Anthropic's recommended ~1568px ceiling and
// re-encode under a byte budget before the file ever hits disk or the remote
// upload, so both the local and remote paste paths stay well under the limit.

const PASTED_IMAGE_MAX_EDGE = 1568;
const PASTED_IMAGE_TARGET_BYTES = 600_000;
// Below this the payload is already cheap; skip the lossy re-encode entirely so
// small icons / diagrams keep their original bytes.
const PASTED_IMAGE_SKIP_BYTES = 200_000;

function swapImageExtension(name: string, ext: string): string {
  const base = name.replace(/\.[^./\\]+$/, "");
  return `${base || "pasted-image"}.${ext}`;
}

async function encodeCanvasUnderBudget(
  canvas: HTMLCanvasElement,
  budgetBytes: number,
): Promise<Blob | null> {
  const qualities = [0.85, 0.72, 0.6, 0.5];
  let last: Blob | null = null;
  for (const quality of qualities) {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), "image/jpeg", quality);
    });
    if (!blob) return last;
    last = blob;
    if (blob.size <= budgetBytes) return blob;
  }
  return last;
}

/**
 * Downscale + recompress a pasted image so it fits comfortably in a model
 * request. Returns the original file untouched when it is already small, is a
 * format we should not rasterize (gif/svg), or when the canvas/createImageBitmap
 * APIs are unavailable (e.g. jsdom in tests). Never throws — on any failure it
 * falls back to the original file.
 */
export async function downscalePastedImage(file: File): Promise<File> {
  const mime = (file.type || "").toLowerCase();
  if (!mime.startsWith("image/")) return file;
  // Animated GIFs and vector SVGs must not be rasterized to a single frame.
  if (mime === "image/gif" || mime === "image/svg+xml") return file;
  if (
    typeof createImageBitmap !== "function" ||
    typeof document === "undefined"
  ) {
    return file;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    if (!width || !height) return file;

    const longest = Math.max(width, height);
    const scale =
      longest > PASTED_IMAGE_MAX_EDGE ? PASTED_IMAGE_MAX_EDGE / longest : 1;
    const needsResize = scale < 1;
    const needsRecompress = file.size > PASTED_IMAGE_SKIP_BYTES;
    if (!needsResize && !needsRecompress) return file;

    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);

    const blob = await encodeCanvasUnderBudget(canvas, PASTED_IMAGE_TARGET_BYTES);
    if (!blob || blob.size >= file.size) return file;

    return new File(
      [blob],
      swapImageExtension(file.name || "pasted-image", "jpg"),
      { type: "image/jpeg", lastModified: file.lastModified },
    );
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
}
