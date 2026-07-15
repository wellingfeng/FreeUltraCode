import type { FileRef } from './filePath';

const HTTP_IMAGE_URL_RE =
  /^https?:\/\/.+\.(?:png|apng|jpe?g|jpe|jfif|pjpeg|pjp|gif|webp|bmp|svg|avif|ico)(?:[?#].*)?$/i;

export function isHttpImageUrl(value: string): boolean {
  return HTTP_IMAGE_URL_RE.test(value.trim());
}

export function createImagePreviewRef(source: string, label?: string): FileRef {
  return {
    path: source,
    basename: imagePreviewLabel(source, label),
    previewKind: 'image',
  };
}

export function directImagePreviewSource(ref: FileRef | null): string | null {
  if (ref?.previewKind !== 'image') return null;
  const source = ref.path.trim();
  return /^(?:https?:\/\/|data:image\/)/i.test(source) ? source : null;
}

function imagePreviewLabel(source: string, label?: string): string {
  const explicit = label?.trim();
  if (explicit) return explicit;
  if (/^data:image\//i.test(source)) return '嵌入图片';

  try {
    const segment = new URL(source).pathname.split('/').filter(Boolean).pop();
    if (segment) return decodeURIComponent(segment);
  } catch {
    // Fall through to the stable generic label.
  }
  return '图片预览';
}
