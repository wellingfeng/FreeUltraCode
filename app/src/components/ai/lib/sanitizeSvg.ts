/**
 * CONTRACT: sanitizeSvg(raw) -> a sanitized SVG document string safe to inject
 * via dangerouslySetInnerHTML.
 *
 * Models occasionally emit a fenced ```svg block (a hand-written or
 * tool-produced diagram). react-markdown treats it as plain code, so without
 * a renderer the user sees source instead of the picture. SvgBlock renders
 * the source, but raw SVG can carry `<script>`, `on*` event handlers, and
 * `javascript:` URLs, so we sanitize first.
 *
 * Approach: parse with DOMParser as image/svg+xml, walk the tree, drop
 * disallowed elements/attributes, then serialize back. A parse failure (the
 * input isn't valid SVG) is surfaced to the caller as `null` so SvgBlock can
 * show a render-failed state instead of injecting garbage.
 */

const BLOCKED_ELEMENTS = new Set([
  'script',
  'foreignObject',
  'iframe',
  'object',
  'embed',
]);

// Attributes whose value is a URL that could be a vector (javascript:, data:
// text/html, …). We keep image/png etc. data URLs on <image href>.
const URL_ATTRS = new Set(['href', 'xlink:href', 'src']);

function isDangerousUrl(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.startsWith('javascript:')) return true;
  if (v.startsWith('data:text/html')) return true;
  if (v.startsWith('data:application/')) return true;
  if (v.startsWith('vbscript:')) return true;
  return false;
}

function sanitizeElement(el: Element): void {
  // Recurse into a static list so removing children mid-walk is safe.
  const children = Array.from(el.children);
  for (const child of children) sanitizeElement(child);

  if (BLOCKED_ELEMENTS.has(el.localName)) {
    el.remove();
    return;
  }

  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    // Drop on* event handlers (onclick, onload, onerror, …).
    if (name.startsWith('on')) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (URL_ATTRS.has(name) && isDangerousUrl(attr.value)) {
      el.removeAttribute(attr.name);
    }
    // style attribute could carry expression() / url(javascript:) in legacy
    // engines; strip it — SvgBlock applies its own container styling.
    if (name === 'style') {
      el.removeAttribute(attr.name);
    }
  }
}

/**
 * Sanitize an SVG document string. Returns the cleaned markup, or `null` when
 * the input does not parse as a standalone SVG document (caller should treat
 * that as a render failure).
 */
export function sanitizeSvg(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parser = new DOMParser();
  const doc = parser.parseFromString(trimmed, 'image/svg+xml');

  // DOMParser surfaces a <parsererror> element when the input is malformed.
  const parserError = doc.querySelector('parsererror');
  if (parserError) return null;

  const root = doc.documentElement;
  if (!root || root.localName !== 'svg') return null;

  sanitizeElement(root);

  // Ensure the root scales into its container instead of overflowing.
  if (!root.getAttribute('viewBox')) {
    const w = root.getAttribute('width');
    const h = root.getAttribute('height');
    if (w && h) root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  root.style.maxWidth = '100%';
  root.style.height = 'auto';

  return new XMLSerializer().serializeToString(root);
}
