import type { CSSProperties } from 'react';
import type { RunStateVisual } from './runStateStyles';

/**
 * Non-component visual chrome for the glassmorphic blueprint node cards:
 * the per-type accent tokens plus the wrapper class + inline-style builders.
 *
 * Kept JSX-free (and separate from {@link ./cardChrome}) so React Fast Refresh
 * stays happy — that file only exports components, this one only helpers.
 *
 * Run-state precedence is preserved: when `run` (from {@link runStateVisual}) is
 * non-null its border/shadow win over the selection accent, exactly as before.
 * All colors come from the CSS design tokens in styles/global.css so every theme
 * preset (including the light `daylight` preset) stays correct.
 */

/** Per-node-type accent + ambient-shadow token pair. */
export interface CardAccent {
  /** Accent color token, e.g. `var(--accent)`. */
  accent: string;
  /** Ambient glow token for the selected lift, e.g. `var(--shadow-accent)`. */
  ambient: string;
}

export const ACCENT_AGENT: CardAccent = {
  accent: 'var(--accent)',
  ambient: 'var(--shadow-accent)',
};
export const ACCENT_PARALLEL: CardAccent = {
  accent: 'var(--accent-2)',
  ambient: 'var(--shadow-accent-2)',
};
export const ACCENT_CONTROL: CardAccent = {
  accent: 'var(--accent-3)',
  ambient: 'var(--shadow-accent-3)',
};
export const ACCENT_END: CardAccent = {
  accent: 'var(--accent-4)',
  ambient: 'var(--shadow-accent-4)',
};

/** Base classes for the glass card wrapper (min-width supplied per node). */
export const CARD_BASE =
  'ugs-card relative overflow-visible rounded-2xl border font-sans ' +
  'transition-[box-shadow,border-color,transform] duration-150 ease-out ' +
  'hover:-translate-y-px';

/** Append the selected marker class (drives the CSS hover rule) when focused. */
export function cardClass(selected: boolean): string {
  return selected ? `${CARD_BASE} ugs-card-selected` : CARD_BASE;
}

export interface CardChromeArgs {
  accent: string;
  ambient: string;
  selected: boolean;
  run: RunStateVisual | null;
  /** Pill terminals use a ring instead of the rail + tint. */
  pill?: boolean;
}

/**
 * Build the inline style for a glass card wrapper, resolving border + shadow
 * against the run state (which always wins) then the selection accent.
 */
export function cardWrapperStyle({
  accent,
  ambient,
  selected,
  run,
  pill = false,
}: CardChromeArgs): CSSProperties {
  const borderColor =
    run?.borderColor ?? (selected || pill ? accent : 'var(--node-border)');
  const selectedShadow = pill
    ? `0 0 0 1px ${accent}, 0 8px 20px -8px ${ambient}, var(--node-shadow)`
    : `0 0 0 1.5px ${accent}, 0 10px 28px -6px ${ambient}, var(--node-shadow)`;
  const boxShadow =
    run?.boxShadow ?? (selected || pill ? selectedShadow : 'var(--node-shadow)');

  const style: CSSProperties = {
    borderColor,
    boxShadow,
    background: 'var(--node-glass)',
  };

  if (!pill) {
    // When a run state is active, the left rail joins the status color so the
    // whole border reads as one ring (otherwise the constant type-accent rail
    // competes with the status border). A touch thicker, too, for emphasis.
    if (run) {
      style.borderLeft = `4px solid ${run.borderColor}`;
    } else {
      style.borderLeft = `3px solid ${accent}`;
    }
    style.backgroundImage =
      'linear-gradient(180deg, var(--node-tint), transparent 64px)';
  }

  // Expose the accent to the CSS hover rule without prop drilling. Custom CSS
  // properties aren't part of React's CSSProperties type, so set via a widened
  // view of the object rather than the typed literal.
  (style as Record<string, string | number | undefined>)['--ugs-node-accent'] =
    accent;

  return style;
}
