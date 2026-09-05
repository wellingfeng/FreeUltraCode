/**
 * CONTRACT: the consolidation-retry loop for the memory review path.
 *
 * Hermes' memory tool handles a full store in three moves: (1) on overflow it
 * REFUSES to write and echoes the current entries back, telling the model to
 * merge; (2) a batch is applied atomically and the char limit is checked only
 * on the FINAL result, so one call can remove/replace to free room AND add;
 * (3) it caps retries at 3 so the model never loops forever.
 *
 * Moves (2) is already enforced inside lib/memoryStore.ts (`applyMemoryBatch`
 * checks the limit only on the final working set). This module wires up moves
 * (1) and (3): it runs the review model, applies whatever it proposes, and when
 * a batch is rejected (overflow / bad oldText / etc.) it formats the rejection
 * with the CURRENT entries and re-invokes the model to consolidate and retry,
 * up to MAX_CONSOLIDATE_RETRIES additional attempts.
 *
 * The model still decides what to remove/merge — nothing is silently dropped.
 * `evictOnOverflow` stays a separate mechanical fallback and is passed through
 * untouched.
 *
 * This module owns the loop; the caller owns the model invocation (its gateway
 * selection differs between the manual refresh and the background self-review).
 */

import {
  REVIEW_SYSTEM,
  DIGEST_SYSTEM,
  buildDigestUserPrompt,
  buildReviewUserPrompt,
  buildConsolidateFeedback,
  buildConsolidateRetryPrompt,
  joinDigestAndTail,
  splitTranscriptForDigest,
  DIGEST_MAX_RATIO,
  MAX_CONSOLIDATE_RETRIES,
} from '@/core/memoryReview';
import { parseMemoryWrites, type MemoryTarget } from '@/core/memoryProtocol';
import { applyMemoryWrites, type MemoryResult } from '@/lib/memoryStore';

export interface ConsolidatingReviewOptions {
  /** Runs one fresh model call; system is REVIEW_SYSTEM (passed through). */
  invokeModel: (system: string, userContent: string) => Promise<string>;
  /** The bounded transcript of what to review. */
  transcript: string;
  /**
   * Raw messages for the two-stage digest path: when given (and summarize is
   * set), the overflow head is model-compressed into a digest that is
   * prepended to the verbatim tail instead of being discarded.
   */
  messages?: { role: string; text: string }[];
  /** Current-store snapshot blocks to inject on the first attempt. */
  contexts?: string[];
  /** Scopes the `memory` store; ignored for `user`. */
  workspaceId?: string;
  /** Passed straight through to the write; off means over-limit rejects. */
  evictOnOverflow?: boolean;
  /** Restrict applied writes to one store (refresh scope); undefined = both. */
  target?: MemoryTarget;
  /** Source label recorded on queued writes (approvalMode 'queue'). */
  source?: 'review' | 'refresh';
  /**
   * Two-stage digest (summary replay): when the transcript overflows its
   * budget, `summarize` compresses the overflow head into dense facts that
   * are prepended to the verbatim tail. Omit → legacy truncate-keep-tail.
   * Should point at the cheap review model; failures fall back to truncation.
   */
  summarize?: (system: string, userContent: string) => Promise<string>;
  /** Extra retries past the first attempt (default MAX_CONSOLIDATE_RETRIES). */
  maxRetries?: number;
  /**
   * 'direct' (default) applies writes to the store immediately. 'queue' stages
   * them into the pending-approval list instead (lib/memoryPending.ts) — used
   * when approvalRequired is on, for autonomous/unsupervised review paths.
   */
  approvalMode?: 'direct' | 'queue';
}

export interface ConsolidatingReviewResult {
  /** Total model invocations made (1 + successful retries, capped). */
  attempts: number;
  /** Operations actually persisted across all rounds (add/replace/remove). */
  appliedOps: number;
  wroteUser: boolean;
  wroteMemory: boolean;
  /** Error strings from the final round's rejections (empty when settled). */
  lastErrors: string[];
  /** Ops staged for approval instead of applied (approvalMode 'queue'). */
  queuedOps: number;
}

export async function runConsolidatingReview(
  opts: ConsolidatingReviewOptions,
): Promise<ConsolidatingReviewResult> {
  const maxAttempts = 1 + Math.max(0, opts.maxRetries ?? MAX_CONSOLIDATE_RETRIES);
  let appliedOps = 0;
  let wroteUser = false;
  let wroteMemory = false;
  let queuedOps = 0;
  let lastErrors: string[] = [];
  let attempts = 0;
  const approvalMode = opts.approvalMode ?? 'direct';

  // Two-stage digest: compress the overflow head instead of dropping it.
  // Runs whenever raw messages + summarize are provided; on any digest
  // failure the caller's pre-built (truncated) transcript is the fallback.
  let digestUsed = false;
  let userContent = '';
  if (opts.messages?.length && opts.summarize) {
    const overflow = splitTranscriptForDigest(opts.messages);
    if (overflow) {
      const digestMax = Math.max(
        200,
        Math.floor(DIGEST_MAX_RATIO * (overflow.overflow.length + overflow.tail.length)),
      );
      try {
        const digest = await opts.summarize(
          DIGEST_SYSTEM,
          buildDigestUserPrompt(overflow.overflow, digestMax),
        );
        userContent = buildReviewUserPrompt(
          joinDigestAndTail(digest.slice(0, digestMax), overflow.tail),
          opts.contexts ?? [],
        );
        digestUsed = true;
      } catch {
        /* digest is best-effort; fall back to the caller's transcript */
      }
    }
  }
  if (!digestUsed) {
    userContent = buildReviewUserPrompt(opts.transcript, opts.contexts ?? []);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    const out = await opts.invokeModel(REVIEW_SYSTEM, userContent);
    const proposals = parseMemoryWrites(out).filter(
      (r) => !opts.target || r.target === opts.target,
    );
    if (!proposals.length) {
      // "无" / nothing emitted — the review is done, nothing to retry.
      lastErrors = [];
      break;
    }

    if (approvalMode === 'queue') {
      // Autonomous path: stage everything and stop looping — there is no
      // rejection feedback to consolidate against until a human approves.
      const { queuePendingMemoryWrites } = await import('./memoryPending');
      queuedOps += await queuePendingMemoryWrites(
        proposals,
        opts.source ?? 'review',
        opts.workspaceId,
      );
      for (const p of proposals) {
        if (p.target === 'user') wroteUser = true;
        if (p.target === 'memory') wroteMemory = true;
      }
      // Staged ops are NOT counted as appliedOps — the caller reports them
      // separately via queuedOps (they have not hit the store yet).
      lastErrors = [];
      break;
    }

    const results = await applyMemoryWrites(proposals, opts.workspaceId, {
      evictOnOverflow: opts.evictOnOverflow,
    });

    const failures: MemoryResult[] = [];
    for (let i = 0; i < proposals.length; i += 1) {
      const r = results[i];
      if (!r || !r.success) {
        if (r) failures.push(r);
        continue;
      }
      appliedOps += proposals[i].operations.length;
      if (proposals[i].target === 'user') wroteUser = true;
      if (proposals[i].target === 'memory') wroteMemory = true;
    }

    if (!failures.length) {
      lastErrors = [];
      break;
    }

    lastErrors = failures.map((f) => f.error ?? '未知错误');
    if (attempt >= maxAttempts) break;

    userContent = buildConsolidateRetryPrompt(
      opts.transcript,
      failures.map((f) =>
        buildConsolidateFeedback({
          target: f.target,
          error: f.error ?? '未知错误',
          entries: f.entries.map((e) => e.text),
          used: f.used,
          limit: f.limit,
        }),
      ),
    );
  }

  return { attempts, appliedOps, wroteUser, wroteMemory, lastErrors, queuedOps };
}
