/**
 * Off-screen SVG `<defs>` for the canvas edges.
 *
 * React Flow renders every edge as an SVG `<path>`, so a 0×0 `<svg>` mounted
 * anywhere inside the same document makes these gradient + filter ids resolvable
 * via `url(#...)` from {@link irToFlow}'s edge styles. Keeping the defs here (not
 * inside `irToFlow`) lets the projection stay a pure data transform — it only
 * ever emits the static string `url(#ugs-edge-exec)` etc.
 *
 * Gradients are defined in objectBoundingBox space so they orient left→right
 * across each edge's bounding box, matching the exec spine's reading direction.
 * Stop colors are theme tokens, so the gradients re-tint per preset for free.
 */
export default function EdgeDefs() {
  return (
    <svg
      className="pointer-events-none absolute"
      width="0"
      height="0"
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id="ugs-edge-exec" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--edge-exec)" stopOpacity="0.85" />
          <stop offset="100%" stopColor="var(--accent-3)" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="ugs-edge-data" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--edge-data)" stopOpacity="0.75" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.85" />
        </linearGradient>
        <filter id="ugs-edge-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}
