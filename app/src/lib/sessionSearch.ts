/**
 * CONTRACT: long-term conversation recall over stored chat history.
 *
 * A pure, dependency-light search over the sessions already persisted by
 * store/history (no SQLite/FTS5, no backend changes). It reads session records
 * through an injected reader so it stays testable and host-agnostic, scores
 * each session against a query, and returns the best matches with a snippet and
 * a small message window around the strongest hit.
 *
 * Scoring is CJK-friendly: queries are matched both as whitespace tokens (for
 * latin terms) AND as character bigrams (for Chinese/Japanese, which have no
 * word spaces). Recency gives a mild tie-breaking boost so "the thing we just
 * discussed" surfaces above an old near-duplicate.
 *
 * This module is pure (no React/store/IO). The caller supplies a reader that
 * lists sessions for a workspace and loads a full session's messages.
 */

export interface SearchableMessage {
  role: string;
  text: string;
  createdAt?: number;
}

export interface SearchableSession {
  workspaceId: string;
  sessionId: string;
  title: string;
  updatedAt: number;
  messages: SearchableMessage[];
}

export interface SessionSearchHit {
  workspaceId: string;
  sessionId: string;
  title: string;
  updatedAt: number;
  score: number;
  /** Best-matching snippet (a single message, trimmed around the match). */
  snippet: string;
  /** Index of the strongest-matching message within the session. */
  anchorIndex: number;
  /** ±window messages around the anchor (role + trimmed text). */
  window: { role: string; text: string }[];
}

export interface SessionSearchOptions {
  /** Max sessions to return. Default 5. */
  limit?: number;
  /** Messages on each side of the anchor in the returned window. Default 2. */
  window?: number;
  /** Max chars of a returned message text before truncation. Default 240. */
  maxChars?: number;
}

const DEFAULT_LIMIT = 5;
const DEFAULT_WINDOW = 2;
const DEFAULT_MAX_CHARS = 240;

/** Lowercase, collapse whitespace. */
function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Split a query into latin tokens (>=2 chars) and CJK character bigrams. */
export function queryTerms(query: string): string[] {
  const q = norm(query);
  if (!q) return [];
  const terms = new Set<string>();
  // Latin / digit runs as whole tokens.
  for (const m of q.matchAll(/[a-z0-9_]+/g)) {
    if (m[0].length >= 2) terms.add(m[0]);
  }
  // CJK runs → overlapping bigrams (and singletons for 1-char runs).
  for (const m of q.matchAll(/[㐀-鿿぀-ヿ]+/g)) {
    const run = m[0];
    if (run.length === 1) {
      terms.add(run);
    } else {
      for (let i = 0; i < run.length - 1; i += 1) terms.add(run.slice(i, i + 2));
    }
  }
  return [...terms];
}

/** Count non-overlapping occurrences of needle in haystack. */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    count += 1;
    from = idx + needle.length;
  }
  return count;
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

/** Build a snippet centered on the first match of any term. */
function snippetFor(text: string, terms: string[], max: number): string {
  const lower = text.toLowerCase();
  let hit = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (hit === -1 || idx < hit)) hit = idx;
  }
  if (hit === -1) return truncate(text, max);
  const start = Math.max(0, hit - Math.floor(max / 3));
  const slice = text.slice(start, start + max);
  const prefix = start > 0 ? '…' : '';
  const suffix = start + max < text.length ? '…' : '';
  return `${prefix}${slice.replace(/\s+/g, ' ').trim()}${suffix}`;
}

/** Score a single session against the query terms. Returns null if no match. */
function scoreSession(
  session: SearchableSession,
  terms: string[],
  now: number,
  opts: Required<SessionSearchOptions>,
): SessionSearchHit | null {
  if (terms.length === 0) return null;

  let total = 0;
  let bestMsgScore = 0;
  let anchorIndex = -1;

  // Title matches are worth extra — they summarize the whole session.
  const titleLower = norm(session.title);
  for (const term of terms) {
    total += countOccurrences(titleLower, term) * 3;
  }

  session.messages.forEach((msg, index) => {
    const lower = norm(msg.text);
    if (!lower) return;
    let msgScore = 0;
    for (const term of terms) {
      msgScore += countOccurrences(lower, term);
    }
    if (msgScore === 0) return;
    total += msgScore;
    if (msgScore > bestMsgScore) {
      bestMsgScore = msgScore;
      anchorIndex = index;
    }
  });

  if (total === 0 || anchorIndex === -1) return null;

  // Mild recency boost: up to +15% for something touched in the last ~30 days.
  const ageDays = Math.max(0, (now - session.updatedAt) / 86_400_000);
  const recency = 1 + 0.15 * Math.exp(-ageDays / 30);
  const score = total * recency;

  const anchor = session.messages[anchorIndex];
  const lo = Math.max(0, anchorIndex - opts.window);
  const hi = Math.min(session.messages.length, anchorIndex + opts.window + 1);
  const window = session.messages.slice(lo, hi).map((m) => ({
    role: m.role,
    text: truncate(m.text, opts.maxChars),
  }));

  return {
    workspaceId: session.workspaceId,
    sessionId: session.sessionId,
    title: session.title,
    updatedAt: session.updatedAt,
    score,
    snippet: snippetFor(anchor.text, terms, opts.maxChars),
    anchorIndex,
    window,
  };
}

/**
 * Rank pre-loaded sessions against a query. Pure and synchronous — the caller
 * is responsible for loading the SearchableSession list (see searchSessions
 * for the async, history-store-backed entry point).
 */
export function rankSessions(
  sessions: SearchableSession[],
  query: string,
  options: SessionSearchOptions = {},
  now: number = Date.now(),
): SessionSearchHit[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const opts: Required<SessionSearchOptions> = {
    limit: options.limit ?? DEFAULT_LIMIT,
    window: options.window ?? DEFAULT_WINDOW,
    maxChars: options.maxChars ?? DEFAULT_MAX_CHARS,
  };
  const hits: SessionSearchHit[] = [];
  for (const session of sessions) {
    const hit = scoreSession(session, terms, now, opts);
    if (hit) hits.push(hit);
  }
  hits.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
  return hits.slice(0, opts.limit);
}

// --- history-store-backed entry point ---------------------------------------

/** Reader the search uses to pull sessions. Mirrors the historyStore subset. */
export interface SessionReader {
  listSessions(
    workspaceId: string,
  ): Promise<{ sessionId?: string; id?: string; title: string; updatedAt: number }[]>;
  getSession(
    workspaceId: string,
    sessionId: string,
  ): Promise<{ messages: SearchableMessage[] } | null>;
}

/**
 * Search a workspace's sessions through a history reader. Loads session
 * summaries, then the full records, ranks them, and returns the top hits.
 * `excludeSessionId` skips the current live session so recall doesn't just
 * echo the conversation in progress.
 */
export async function searchSessions(
  reader: SessionReader,
  workspaceId: string,
  query: string,
  options: SessionSearchOptions & { excludeSessionId?: string } = {},
): Promise<SessionSearchHit[]> {
  if (queryTerms(query).length === 0) return [];
  const summaries = await reader.listSessions(workspaceId);
  const loaded: SearchableSession[] = [];
  for (const summary of summaries) {
    const sessionId = summary.sessionId ?? summary.id;
    if (!sessionId) continue;
    if (options.excludeSessionId && sessionId === options.excludeSessionId) continue;
    const record = await reader.getSession(workspaceId, sessionId);
    if (!record) continue;
    loaded.push({
      workspaceId,
      sessionId,
      title: summary.title,
      updatedAt: summary.updatedAt,
      messages: record.messages,
    });
  }
  return rankSessions(loaded, query, options);
}

/** Render hits into a compact text block for injection into a tool result. */
export function formatRecallHits(hits: SessionSearchHit[]): string {
  if (hits.length === 0) return '（未找到相关历史会话）';
  const blocks = hits.map((hit, i) => {
    const date = new Date(hit.updatedAt).toISOString().slice(0, 10);
    const lines = [`${i + 1}. 《${hit.title}》（${date}）`, `   命中：${hit.snippet}`];
    if (hit.window.length) {
      lines.push('   上下文：');
      for (const m of hit.window) {
        const who = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : m.role;
        lines.push(`     ${who}：${m.text}`);
      }
    }
    return lines.join('\n');
  });
  return blocks.join('\n\n');
}
