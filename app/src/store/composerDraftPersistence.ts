// Composer-draft disk persistence.
//
// `composerDraft` / `composerDrafts` in the Zustand store are pure UI state that
// lives only in memory. This module adds a *trailing-debounced* write of the
// active session's unsent draft into the session record's `meta.composerDraft`
// so a draft survives an app restart.
//
// Debounce (not per-keystroke write) matters: `historyStore.updateSession`
// rewrites the whole session JSON + rebuilds the session index + touches the
// workspace on every call, so a bare per-keystroke write would triple disk
// write amplification. `preserveUpdatedAt: true` keeps "typing a draft" from
// bumping the session to the top of the history list.
//
// The trailing window is the only loss bound: text typed in the final
// ~30s before a hard process kill can still be lost. The normal Tauri exit
// path (tray "退出" → `ugs:before-quit`) calls `flushComposerDraftPersist`
// via quitFlush, so that path does not lose the tail.

import { historyStore } from './history/store';

interface PendingComposerDraft {
  workspaceId: string;
  sessionId: string;
  text: string;
}

export const COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS = 30_000;

let pendingDraft: PendingComposerDraft | null = null;
let pendingDraftTimer: ReturnType<typeof setTimeout> | null = null;

/** Reset module state for tests. */
export function resetComposerDraftPersistForTests(): void {
  if (pendingDraftTimer) {
    clearTimeout(pendingDraftTimer);
    pendingDraftTimer = null;
  }
  pendingDraft = null;
}

/**
 * Schedule a trailing-debounced persist of `text` as the draft of
 * (workspaceId, sessionId). Null ids are not persistable and are ignored.
 */
export function scheduleComposerDraftPersist(
  workspaceId: string | null,
  sessionId: string | null,
  text: string,
): void {
  if (!workspaceId || !sessionId) return;
  pendingDraft = { workspaceId, sessionId, text };
  if (pendingDraftTimer) clearTimeout(pendingDraftTimer);
  pendingDraftTimer = setTimeout(() => {
    pendingDraftTimer = null;
    void flushComposerDraftPersist();
  }, COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS);
}

/**
 * Immediately write the latest pending draft (if any) and clear the pending
 * slot. Safe to call on quit: the write is awaited so callers can wait on the
 * returned promise before releasing the process.
 */
export async function flushComposerDraftPersist(): Promise<void> {
  if (pendingDraftTimer) {
    clearTimeout(pendingDraftTimer);
    pendingDraftTimer = null;
  }
  const next = pendingDraft;
  pendingDraft = null;
  if (!next) return;
  try {
    await historyStore.updateSession(next.workspaceId, next.sessionId, {
      meta: { composerDraft: next.text },
      preserveUpdatedAt: true,
    });
  } catch (err) {
    console.error('[composer-draft] failed to persist draft', err);
  }
}
