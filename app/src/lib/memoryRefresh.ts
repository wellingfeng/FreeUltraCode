/**
 * CONTRACT: manual "refresh memory from recent history" for the Settings →
 * Memory panel.
 *
 * The background self-review loop (core/memoryReview.ts) only replays the
 * transcript of the turn that just finished. This module is the on-demand
 * counterpart: it walks the persisted chat history for the last N days, builds
 * one bounded transcript, asks the SAME review prompts to extract durable
 * facts, and applies the resulting <<UGS_MEMORY>> writes to disk.
 *
 * Two scopes, mirroring the two memory stores (lib/memoryStore.ts):
 *   - 'global'  → user profile (`user` store, global): reviews ALL workspaces
 *     because "who the user is" spans projects, and only applies `user` writes.
 *   - 'project' → assistant notes (`memory` store, per-workspace): reviews only
 *     the given workspace and only applies `memory` writes.
 *
 * The write lands on the NEXT session's frozen snapshot — it never mutates the
 * live system prompt (see memoryStore.ts CONTRACT).
 */

import { historyStore } from '@/store/history/store';
import { buildReviewTranscript, formatReviewMemoryContext } from '@/core/memoryReview';
import { getMemoryUsage } from '@/lib/memoryStore';
import { runConsolidatingReview } from '@/lib/memoryConsolidate';
import {
  completeGatewayText,
  resolveCliGatewayRoute,
  resolveDirectGatewayRoute,
} from '@/lib/modelGateway/modelGateway';
import {
  getDefaultGatewaySelection,
  getExplicitActiveGatewaySelection,
} from '@/lib/gatewayConfig';

export type RefreshScope = 'global' | 'project';

export interface RefreshMemoryOptions {
  scope: RefreshScope;
  /** Number of days of history to review (min 1). */
  days: number;
  /** Workspace id for the 'project' scope; ignored for 'global'. */
  workspaceId?: string;
  /** Evict oldest entries when a write overflows (mirrors MemoryConfig). */
  evictOnOverflow?: boolean;
  /** Cap on the review transcript size in chars. Default 12_000. */
  maxTranscriptChars?: number;
  /** Cap on how many sessions to load (most recent kept). Default 60. */
  maxSessions?: number;
}

export interface RefreshMemoryResult {
  ok: boolean;
  scope: RefreshScope;
  /** Number of sessions whose messages were loaded (within the window). */
  sessionsScanned: number;
  /** Number of user/assistant messages folded into the transcript. */
  messagesScanned: number;
  /** Number of memory operations applied (add/replace/remove). */
  appliedOps: number;
  wroteUser: boolean;
  wroteMemory: boolean;
  error?: string;
}

const DAY_MS = 86_400_000;
const DEFAULT_MAX_TRANSCRIPT_CHARS = 12_000;
const DEFAULT_MAX_SESSIONS = 60;

export async function refreshMemoryFromHistory(
  options: RefreshMemoryOptions,
): Promise<RefreshMemoryResult> {
  const scope = options.scope;
  const days = Math.max(1, Math.floor(options.days || 10));
  const cutoff = Date.now() - days * DAY_MS;
  const maxTranscriptChars =
    options.maxTranscriptChars ?? DEFAULT_MAX_TRANSCRIPT_CHARS;
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;

  try {
    // Reads self-heal: listSessions() rebuilds its index lazily from the session
    // files when out of date, and listWorkspaces() returns [] when uninitialized.
    const workspaceIds =
      scope === 'global'
        ? (await historyStore.listWorkspaces()).map((w) => w.id).filter(Boolean)
        : [options.workspaceId].filter((v): v is string => !!v);

    // Collect in-window sessions across the selected scope. Sort newest-first,
    // keep the most recent `maxSessions`, then reverse to oldest-first so the
    // tail-kept truncation in buildReviewTranscript retains the newest content.
    const candidates: { wsId: string; sessionId: string; updatedAt: number }[] = [];
    for (const wsId of workspaceIds) {
      const summaries = await historyStore.listSessions(wsId);
      for (const summary of summaries) {
        if (summary.updatedAt >= cutoff) {
          candidates.push({
            wsId,
            sessionId: summary.id,
            updatedAt: summary.updatedAt,
          });
        }
      }
    }
    candidates.sort((a, b) => b.updatedAt - a.updatedAt);
    const qualifying = candidates.slice(0, maxSessions).reverse();

    const messages: { role: string; text: string }[] = [];
    for (const { wsId, sessionId } of qualifying) {
      const record = await historyStore.getSession(wsId, sessionId);
      if (!record) continue;
      for (const msg of record.messages) {
        if (msg.role !== 'user' && msg.role !== 'assistant') continue;
        const text = msg.text?.trim();
        if (!text) continue;
        messages.push({ role: msg.role, text });
      }
    }

    const sessionsScanned = qualifying.length;
    const messagesScanned = messages.length;
    if (messagesScanned === 0) {
      return {
        ok: true,
        scope,
        sessionsScanned,
        messagesScanned: 0,
        appliedOps: 0,
        wroteUser: false,
        wroteMemory: false,
      };
    }

    const target = scope === 'global' ? 'user' : 'memory';
    const transcript = buildReviewTranscript(messages, maxTranscriptChars);

    // Give the review model the live inventory of the target store so it can
    // consolidate (merge overlap / drop stale) before adding — mirroring the
    // "current entries on overflow" affordance in Hermes' memory tool. Without
    // this a full store rejects every add and the review never writes again.
    const usage = await getMemoryUsage(target, options.workspaceId);
    const context = formatReviewMemoryContext({
      label: target === 'user' ? '用户画像（全局）' : '助手笔记（本项目）',
      entries: usage.entries.map((e) => e.text),
      used: usage.used,
      limit: usage.limit,
    });

    const out = await runConsolidatingReview({
      invokeModel: (system, userContent) => completeReview(system, userContent),
      transcript,
      contexts: [context],
      workspaceId: options.workspaceId,
      evictOnOverflow: options.evictOnOverflow,
      target,
    });

    return {
      ok: true,
      scope,
      sessionsScanned,
      messagesScanned,
      appliedOps: out.appliedOps,
      wroteUser: out.wroteUser,
      wroteMemory: out.wroteMemory,
    };
  } catch (err) {
    return {
      ok: false,
      scope,
      sessionsScanned: 0,
      messagesScanned: 0,
      appliedOps: 0,
      wroteUser: false,
      wroteMemory: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Run the review prompts through the active gateway (direct, then CLI). */
async function completeReview(system: string, userContent: string): Promise<string> {
  const selection =
    getExplicitActiveGatewaySelection() ?? getDefaultGatewaySelection();
  const direct = resolveDirectGatewayRoute(selection);
  if (direct) {
    return completeGatewayText({
      route: direct,
      system,
      userContent,
      maxTokens: 8192,
    });
  }
  const cli = await resolveCliGatewayRoute(selection);
  return completeGatewayText({
    route: cli,
    system,
    userContent,
    maxTokens: 8192,
    forceCli: true,
  });
}
