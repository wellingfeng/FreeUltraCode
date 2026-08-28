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
  buildReviewUserPrompt,
  buildConsolidateFeedback,
  buildConsolidateRetryPrompt,
  MAX_CONSOLIDATE_RETRIES,
} from '@/core/memoryReview';
import { parseMemoryWrites, type MemoryTarget } from '@/core/memoryProtocol';
import { applyMemoryWrites, type MemoryResult } from '@/lib/memoryStore';

export interface ConsolidatingReviewOptions {
  /** Runs one fresh model call; system is REVIEW_SYSTEM (passed through). */
  invokeModel: (system: string, userContent: string) => Promise<string>;
  /** The bounded transcript of what to review. */
  transcript: string;
  /** Current-store snapshot blocks to inject on the first attempt. */
  contexts?: string[];
  /** Scopes the `memory` store; ignored for `user`. */
  workspaceId?: string;
  /** Passed straight through to the write; off means over-limit rejects. */
  evictOnOverflow?: boolean;
  /** Restrict applied writes to one store (refresh scope); undefined = both. */
  target?: MemoryTarget;
  /** Extra retries past the first attempt (default MAX_CONSOLIDATE_RETRIES). */
  maxRetries?: number;
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
}

export async function runConsolidatingReview(
  opts: ConsolidatingReviewOptions,
): Promise<ConsolidatingReviewResult> {
  const maxAttempts = 1 + Math.max(0, opts.maxRetries ?? MAX_CONSOLIDATE_RETRIES);
  let userContent = buildReviewUserPrompt(opts.transcript, opts.contexts ?? []);
  let appliedOps = 0;
  let wroteUser = false;
  let wroteMemory = false;
  let lastErrors: string[] = [];
  let attempts = 0;

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

  return { attempts, appliedOps, wroteUser, wroteMemory, lastErrors };
}
