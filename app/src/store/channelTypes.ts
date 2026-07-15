// Channel type definitions for the run/AI-edit streaming engine.
//
// Extracted verbatim from useStore.ts as the first, lowest-risk step of the
// streaming-logic decomposition (architect M3). This file is TYPE-ONLY: it has
// no runtime code and imports nothing from useStore, so it cannot participate in
// the store import cycle. useStore.ts re-exports these names, so existing
// `import type { AiEditChannel } from './useStore'` sites keep working unchanged.
import type { GatewaySelection, IRGraph } from '@/core/ir';
import type { Message, NodeRunState } from './types';

export interface RunConfig {
  cwd?: string;
  extraWorkspacePaths?: string[];
  permission?: string;
  model?: string;
  cliCommand?: string;
  gatewaySelection?: GatewaySelection;
}

/**
 * A run is bound to the session that started it — NOT to whatever session the
 * user is currently viewing. This channel is that run's single source of truth:
 * the run loop reads/writes the shadow state here, and `channelCommit` mirrors it
 * into the live store ONLY while the owning session is the active view, and
 * persists it to the owning session regardless. That decoupling is what lets a
 * run keep executing in the background after the user switches to another
 * session (and resume seamlessly when they switch back). Multiple sessions may
 * have their own channels so independent workflow blueprints can run together.
 */
export interface RunChannel {
  key: string;
  workspaceId: string | null;
  sessionId: string | null;
  cancelled: boolean;
  workflow: IRGraph;
  config: RunConfig;
  cliRunIds: Set<string>;
  messages: Message[];
  runState: Record<string, NodeRunState>;
  runOutputs: Record<string, string>;
  failedNodeId: string | null;
  error: Record<string, unknown> | null;
  /**
   * Per-node content hashes from this run (runtime `computeNodeHashes`). Captured
   * when the run finishes and persisted in the run snapshot, so the next
   * "continue" reuses a cached node output only when its hash still matches —
   * editing the graph re-runs the affected subgraph. Absent until the run ends.
   */
  nodeHashes?: Record<string, string>;
}

export interface AiEditChannel {
  key: string;
  sessionKey: string;
  workspaceId: string | null;
  sessionId: string | null;
  /** Filesystem root used for this turn's session-change snapshot. */
  workspaceRootPath?: string | null;
  workflow: IRGraph;
  messages: Message[];
  cliRunIds: Set<string>;
  abortController: AbortController;
  /** Gateway/model snapshot captured when this AI turn started. */
  gatewaySelection?: GatewaySelection;
  /** Whether this channel belongs to a history session that should store IRGraph. */
  workflowSession: boolean;
  /**
   * True for simple-workflow chat turns. Such turns reuse the AI-edit channel
   * plumbing (message persistence, background completion, userInputs commit) but
   * are NOT "blueprint editing": they surface as `chattingSessions` rather than
   * `aiEditingSessions`, so they don't lock the (nonexistent) canvas as
   * read-only. See sendPrompt's simpleMode branch.
   */
  chat?: boolean;
  /** Message ids created by this chat turn; used to merge concurrent replies. */
  ownedMessageIds?: Set<string>;
  /**
   * Active CLI run with native steering. The explicit lightning action can steer a
   * queued follow-up into this turn without cancelling it. Normal sends remain
   * in the per-session FIFO queue.
   */
  liveSteer?: {
    adapter: GatewaySelection['adapter'];
    runId: string;
    accepting: boolean;
  };
}

export interface ChatNativeSession {
  sessionId: string;
  started: boolean;
  coveredMessageCount: number;
}

