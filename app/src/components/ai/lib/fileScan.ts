/**
 * CONTRACT: scanFileRefs(text) -> Array<string | FileRef>
 *
 * Splits a run of prose into alternating plain-text strings and detected file
 * references, so a bare `Sidebar.tsx` or `app/src/store/useStore.ts:42` sitting
 * in ordinary text (not inside backticks or a markdown link) can be rendered as
 * a clickable chip.
 *
 * Detection scans for maximal runs of path-ish characters, including Unicode
 * letters for generated filenames such as `Moon亮晶分析.html`. Each run is
 * trimmed of trailing sentence
 * punctuation, then validated by {@link parseFileRef}, which stays strict (known
 * extension or a real separator) so prose like `2.0` or `react.useState` is
 * never matched. The colon introducing a `:line` suffix is preserved.
 */

import { parseFileRef, type FileRef } from './filePath';

export type FileScanPart = string | FileRef;

// A maximal run of path-ish characters. Whitespace, quotes, pipes, and most
// punctuation end the run; parseFileRef keeps false positives low.
const PATH_RUN = /[\p{L}\p{N}._~$@+%\-/\\:#]+/gu;

// Trailing punctuation to peel off a token before validation (but NOT a digit
// after ':' — that is a line number). We only strip from the very end.
const TRAILING = /[.,;:!?]+$/;

// An absolute Windows path anchor embedded somewhere inside a run: a drive
// letter (`E:\` / `E:/`) or a UNC prefix (`\\`). Because PATH_RUN also matches
// Unicode letters, prose glued directly onto a pasted absolute path with no
// separating whitespace (`看这个图片E:\…\shot.png`) is swallowed into a single
// run whose embedded drive colon then defeats parseFileRef. When the whole run
// fails to parse we retry from the first such anchor and treat the preceding
// characters as plain prose. A drive letter is a single character, so the match
// index lands exactly on the path start regardless of what prose precedes it.
const EMBEDDED_ABS_ANCHOR = /[A-Za-z]:[\\/]|\\\\/;

/** Cheap whole-string gate: does the text contain any path-ish punctuation? */
function mightContainPath(text: string): boolean {
  return text.includes('.') || /[\\/]/.test(text);
}

/**
 * Split trailing sentence punctuation off a candidate token, leaving a `:NN`
 * line/column suffix intact. Returns the cleaned core plus the peeled tail.
 */
function stripTrailingPunctuation(token: string): { core: string; trailing: string } {
  if (/[:#]L?\d/.test(token)) return { core: token, trailing: '' };
  const tm = token.match(TRAILING);
  if (!tm) return { core: token, trailing: '' };
  return { core: token.slice(0, token.length - tm[0].length), trailing: tm[0] };
}

export function scanFileRefs(text: string): FileScanPart[] {
  if (!mightContainPath(text)) return [text];

  const out: FileScanPart[] = [];
  let cursor = 0;

  const pushText = (s: string) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (typeof last === 'string') out[out.length - 1] = last + s;
    else out.push(s);
  };

  PATH_RUN.lastIndex = 0;
  for (let m = PATH_RUN.exec(text); m; m = PATH_RUN.exec(text)) {
    const run = m[0];
    let start = m.index;
    let core = run;

    // Prose glued onto an absolute path with no separating space lands the whole
    // thing in one run (`看这个图片E:\…\shot.png`). An absolute anchor — a drive
    // letter (`E:\`/`E:/`) or UNC prefix (`\\`) — marks a path start that can't
    // have valid path content before it. When one appears mid-run AND the
    // remainder parses as a file, split there and emit the prefix as plain text.
    // Gating on a successful parse keeps URLs (`https://…`, whose `s://` also
    // matches the drive shape) and other non-paths from being fragmented.
    const anchor = core.search(EMBEDDED_ABS_ANCHOR);
    if (anchor > 0 && parseFileRef(stripTrailingPunctuation(core.slice(anchor)).core)) {
      pushText(text.slice(cursor, start + anchor));
      cursor = start + anchor;
      start += anchor;
      core = run.slice(anchor);
    }

    // Peel trailing sentence punctuation, but never strip a `:NN` line suffix.
    const peeled = stripTrailingPunctuation(core);
    core = peeled.core;
    const trailing = peeled.trailing;

    const ref = core.length > 1 ? parseFileRef(core) : null;
    if (ref) {
      pushText(text.slice(cursor, start));
      out.push(ref);
      if (trailing) pushText(trailing);
      cursor = start + core.length + trailing.length;
    }
    // No match: leave the run in the pending plain-text span (flushed below).
  }

  pushText(text.slice(cursor));

  // Collapse to the original string when nothing matched (lets callers skip the
  // chip path entirely).
  if (out.length === 0) return [text];
  if (out.length === 1 && typeof out[0] === 'string') return [text];
  return out;
}

/** True when the text contains at least one detectable file reference. */
export function hasFileRef(text: string): boolean {
  return scanFileRefs(text).some((p) => typeof p !== 'string');
}
