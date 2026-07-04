import { type ReactNode } from "react";

export interface SearchHighlightState {
  query: string;
  messageId: string;
  /** Mutable counter shared across all text nodes in one message. */
  hitCounter: { current: number };
  activeMatchId: string | null;
  onActiveMatchNode?: (node: HTMLElement | null) => void;
}

/**
 * Wrap search-query matches in `<mark>` elements within a plain text string.
 *
 * Increments `state.hitCounter` for each match and assigns match IDs following
 * the same scheme as `buildSearchMatches` in `aidock/search.ts`:
 *   `${messageId}:text:${hitIndex}`
 *
 * This lets the scroll-to-active logic in AIDock find the exact DOM node for
 * the currently active match via `data-search-match-id`.
 */
export function highlightSearchMarks(
  text: string,
  state: SearchHighlightState | null,
  keyPrefix?: string,
): ReactNode {
  if (!state || !state.query) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = state.query.toLowerCase();
  if (!lowerQuery || !lowerText.includes(lowerQuery)) return text;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  let hasMatch = false;

  while (cursor <= lowerText.length) {
    const found = lowerText.indexOf(lowerQuery, cursor);
    if (found === -1) break;
    if (found > cursor) nodes.push(text.slice(cursor, found));

    const hitIndex = state.hitCounter.current;
    state.hitCounter.current += 1;
    const matchId = `${state.messageId}:text:${hitIndex}`;
    const isActive = matchId === state.activeMatchId;

    nodes.push(
      <mark
        key={`${keyPrefix ?? "sh"}-${hitIndex}`}
        data-search-match-id={matchId}
        ref={isActive ? state.onActiveMatchNode : undefined}
        className={
          "rounded-sm px-0.5 text-fg transition-colors " +
          (isActive
            ? "bg-accent-3/35 ring-1 ring-inset ring-accent-3/55"
            : "bg-accent/20")
        }
      >
        {text.slice(found, found + lowerQuery.length)}
      </mark>,
    );

    cursor = found + Math.max(lowerQuery.length, 1);
    hasMatch = true;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return hasMatch ? nodes : text;
}
