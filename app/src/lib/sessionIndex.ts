/**
 * CONTRACT: indexed, cached long-term conversation recall.
 *
 * `sessionSearch.searchSessions` is correct but O(N × full-text): it re-reads
 * every session record and scans all of its messages on each recall. For
 * workspaces with many sessions that makes recall feel slow.
 *
 * This module wraps the same reader with an in-memory inverted index, keyed by
 * workspace. It is transparent: results are identical to `searchSessions`, only
 * the IO is cheaper.
 *   - The session list (ids + updatedAt) forms a canonical signature. When the
 *     signature is unchanged, the cached sessions AND postings are reused and
 *     zero `getSession` calls happen.
 *   - When it changes, only new/changed sessions are reloaded (incremental).
 *   - `postings` maps query terms → candidate session indices, so scoring runs
 *     only over sessions that can actually match, never the whole workspace.
 *
 * Index terms mirror `queryTerms`: latin tokens are indexed as all length-≥2
 * substrings (so a query token that is a substring of a longer word still
 * matches, exactly like `countOccurrences`), CJK as bigrams + singletons. Any
 * token too long to index marks the session "unfiltered" so it is always
 * considered — the index can over-approximate candidates but never drop one.
 *
 * This module is pure apart from its private cache (no React/store). Callers
 * supply the same `SessionReader` used by `searchSessions`.
 */

import {
  queryTerms,
  rankSessions,
  type SearchableSession,
  type SessionReader,
  type SessionSearchHit,
  type SessionSearchOptions,
} from './sessionSearch';

/** Latin tokens longer than this mark a session "unfiltered" (always a candidate). */
const MAX_LATIN_TOKEN = 32;
/** Bound the per-workspace cache so memory doesn't grow unboundedly. */
const MAX_CACHED_WORKSPACES = 24;

interface IndexCacheEntry {
  signature: string;
  /** All sessions for the workspace (exclusion happens at query time). */
  sessions: SearchableSession[];
  /** term → indices into `sessions` (ascending, de-duplicated per session). */
  postings: Map<string, number[]>;
  /** Sessions containing a latin token too long to index — always candidates. */
  unfiltered: number[];
}

const cache = new Map<string, IndexCacheEntry>();

function buildSignature(
  summaries: { sessionId?: string; id?: string; updatedAt: number }[],
): string {
  return summaries
    .map((s) => `${s.sessionId ?? s.id}:${s.updatedAt}`)
    .sort()
    .join('|');
}

/** Extract the same indexable terms `queryTerms` would, plus latin substrings. */
function indexKeysFor(text: string): { keys: Set<string>; hasLongToken: boolean } {
  const q = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const keys = new Set<string>();
  let hasLongToken = false;
  // Latin / digit runs: index every length-≥2 substring so a query token that
  // is a substring of a longer word still matches `countOccurrences`.
  for (const m of q.matchAll(/[a-z0-9_]+/g)) {
    const tok = m[0];
    if (tok.length < 2) continue;
    if (tok.length > MAX_LATIN_TOKEN) {
      hasLongToken = true;
      continue;
    }
    for (let i = 0; i < tok.length; i += 1) {
      for (let len = 2; i + len <= tok.length; len += 1) {
        keys.add(tok.slice(i, i + len));
      }
    }
  }
  // CJK runs → overlapping bigrams (and singletons for 1-char runs).
  for (const m of q.matchAll(/[㐀-鿿぀-ヿ]+/g)) {
    const run = m[0];
    if (run.length === 1) {
      keys.add(run);
    } else {
      for (let i = 0; i < run.length - 1; i += 1) keys.add(run.slice(i, i + 2));
    }
  }
  return { keys, hasLongToken };
}

function buildPostings(
  sessions: SearchableSession[],
): { postings: Map<string, number[]>; unfiltered: number[] } {
  const postings = new Map<string, number[]>();
  const unfiltered: number[] = [];
  sessions.forEach((session, idx) => {
    let hasLong = false;
    const add = (text: string) => {
      const { keys, hasLongToken } = indexKeysFor(text);
      if (hasLongToken) hasLong = true;
      for (const key of keys) {
        let arr = postings.get(key);
        if (!arr) {
          arr = [];
          postings.set(key, arr);
        }
        // Sessions are processed in order, so a consecutive duplicate is the
        // same session seen in another title/message — skip it.
        if (arr[arr.length - 1] !== idx) arr.push(idx);
      }
    };
    add(session.title);
    session.messages.forEach((m) => add(m.text));
    if (hasLong) unfiltered.push(idx);
  });
  return { postings, unfiltered };
}

function candidateIndices(entry: IndexCacheEntry, terms: string[]): number[] {
  const seen = new Set<number>();
  for (const term of terms) {
    const arr = entry.postings.get(term);
    if (arr) for (const idx of arr) seen.add(idx);
  }
  for (const idx of entry.unfiltered) seen.add(idx);
  // Ascending so the candidate order matches listSessions order — keeps the
  // result byte-identical to `searchSessions` even on score/recency ties.
  return [...seen].sort((a, b) => a - b);
}

async function rebuild(
  reader: SessionReader,
  workspaceId: string,
  summaries: { sessionId?: string; id?: string; title: string; updatedAt: number }[],
  signature: string,
  prev: IndexCacheEntry | undefined,
): Promise<IndexCacheEntry> {
  const prevBySession = prev
    ? new Map(prev.sessions.map((s) => [s.sessionId, s]))
    : new Map<string, SearchableSession>();
  const sessions: SearchableSession[] = [];
  for (const summary of summaries) {
    const sessionId = summary.sessionId ?? summary.id;
    if (!sessionId) continue;
    const cached = prevBySession.get(sessionId);
    if (cached && cached.updatedAt === summary.updatedAt) {
      sessions.push(cached);
      continue;
    }
    const record = await reader.getSession(workspaceId, sessionId);
    if (!record) continue;
    sessions.push({
      workspaceId,
      sessionId,
      title: summary.title,
      updatedAt: summary.updatedAt,
      messages: record.messages,
    });
  }
  const { postings, unfiltered } = buildPostings(sessions);
  return { signature, sessions, postings, unfiltered };
}

function trimCache(): void {
  while (cache.size > MAX_CACHED_WORKSPACES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Search a workspace's sessions through a history reader, using an in-memory
 * inverted index to avoid re-reading every session on each recall. Results are
 * identical to `searchSessions` for the same reader/query/options.
 */
export async function searchSessionsIndexed(
  reader: SessionReader,
  workspaceId: string,
  query: string,
  options: SessionSearchOptions & { excludeSessionId?: string } = {},
): Promise<SessionSearchHit[]> {
  if (queryTerms(query).length === 0) return [];
  const summaries = await reader.listSessions(workspaceId);
  const signature = buildSignature(summaries);
  let entry = cache.get(workspaceId);
  if (!entry || entry.signature !== signature) {
    entry = await rebuild(reader, workspaceId, summaries, signature, entry);
    cache.set(workspaceId, entry);
    trimCache();
  }
  const indices = candidateIndices(entry, queryTerms(query));
  const candidates = indices
    .map((idx) => entry.sessions[idx])
    .filter(
      (s) => !options.excludeSessionId || s.sessionId !== options.excludeSessionId,
    );
  return rankSessions(candidates, query, options);
}

/** Drop the cached index for a workspace (or all workspaces). */
export function invalidateSessionIndex(workspaceId?: string): void {
  if (workspaceId === undefined) cache.clear();
  else cache.delete(workspaceId);
}
