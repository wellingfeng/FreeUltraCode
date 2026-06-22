/**
 * CONTRACT: structured `/studio` run progress carried inline in the CLI's
 * stderr stream, so the desktop GUI can render a live run-progress card (agent
 * count, elapsed time, per-node status, expandable detail) instead of parsing
 * localized/emoji log text.
 *
 * The bundled CLI (`ugs studio`) executes as a child process; its stderr is
 * piped back to the GUI line-by-line over the existing `ai-cli-progress` Tauri
 * event. When stderr is NOT a TTY (i.e. captured by the GUI), the CLI also
 * weaves sentinel blocks into that stream:
 *
 *   <<UGS_PROGRESS>>{ ...json StudioProgressEvent... }<<UGS_PROGRESS_END>>
 *
 * mirroring the `<<UGS_TOOL>>` / `<<UGS_ASK>>` sentinel approach. The GUI strips
 * these out of the visible text, decodes them in stream order, and folds them
 * into an {@link StudioRunProgress} snapshot via {@link reduceProgress}.
 *
 * This module is pure (types + encode/decode + reduce) so it is shared by the
 * CLI emitter, the GUI store, and tests. No react / zustand / tauri / node.
 */

/** Per-node run status mirrored from the runtime's IRRunStatus subset. */
export type StudioNodeStatus = 'running' | 'success' | 'error' | 'interrupted';

/** Run phase reported by the CLI (planning → executing → terminal). */
export type StudioPhase = 'planning' | 'executing' | 'complete' | 'error';

export type StudioProgressEvent =
  /** Phase transition (planning/executing/complete/error). */
  | { kind: 'phase'; phase: StudioPhase }
  /**
   * The execution harness graph has been built. Carries the total runnable node
   * count (denominator for the progress bar), the agent-call budget ceiling, and
   * the frozen objective (card title).
   */
  | {
      kind: 'harness_ready';
      totalNodes: number;
      maxAgentCalls: number;
      objective: string;
    }
  /** A node entered/left a state. `label` is the node's human label, if any. */
  | { kind: 'node'; id: string; label?: string; status: StudioNodeStatus }
  /** Cumulative agent calls spent so far (the card's "N Agents"). */
  | { kind: 'agent_calls'; spent: number };

/** One node row in the expanded detail view. */
export interface StudioNodeProgress {
  id: string;
  label: string;
  status: StudioNodeStatus;
}

/**
 * Reduced, render-ready snapshot of a `/studio` run. `null`-ish fields stay
 * 0/'' until the corresponding event arrives, so a partially-started run still
 * renders sanely.
 */
export interface StudioRunProgress {
  phase: StudioPhase;
  objective: string;
  /** Agent calls spent so far — the card's headline "N Agents". */
  agentCalls: number;
  /** Agent-call budget ceiling (0 until harness_ready). */
  maxAgentCalls: number;
  /** Total runnable nodes in the execution harness (0 until harness_ready). */
  totalNodes: number;
  /** Per-node rows, in first-seen order. */
  nodes: StudioNodeProgress[];
  /**
   * Host-populated wall-clock timing (epoch ms). NOT set by progress events —
   * the GUI store stamps these and {@link reduceProgress} preserves them — so
   * the card can show elapsed time without threading a separate ref.
   */
  startedAt?: number;
  endedAt?: number;
}

export const PROGRESS_OPEN = '<<UGS_PROGRESS>>';
export const PROGRESS_CLOSE = '<<UGS_PROGRESS_END>>';

/** Serialise one progress event into an inline sentinel block (with newlines). */
export function encodeProgressEvent(event: StudioProgressEvent): string {
  return `\n${PROGRESS_OPEN}${JSON.stringify(event)}${PROGRESS_CLOSE}\n`;
}

/** True when the text contains at least one progress sentinel (fast pre-check). */
export function hasProgressSentinel(text: string): boolean {
  return text.includes(PROGRESS_OPEN);
}

export interface ProgressSentinelSplit {
  /** The text with all progress sentinel blocks removed. */
  text: string;
  /** Events decoded from the sentinels, in stream order. */
  events: StudioProgressEvent[];
}

/**
 * Pull every `<<UGS_PROGRESS>>…<<UGS_PROGRESS_END>>` block out of `text`,
 * returning the cleaned text and the decoded events in order. An incomplete
 * trailing sentinel (half-streamed, no close yet) is left verbatim so it can
 * complete on the next chunk; malformed JSON blocks are dropped silently.
 */
export function decodeProgressEvents(text: string): ProgressSentinelSplit {
  if (!text.includes(PROGRESS_OPEN)) {
    return { text, events: [] };
  }

  const events: StudioProgressEvent[] = [];
  let out = '';
  let cursor = 0;

  for (;;) {
    const open = text.indexOf(PROGRESS_OPEN, cursor);
    if (open === -1) {
      out += text.slice(cursor);
      break;
    }
    const close = text.indexOf(PROGRESS_CLOSE, open + PROGRESS_OPEN.length);
    if (close === -1) {
      // Incomplete trailing sentinel — keep it verbatim for the next chunk.
      out += text.slice(cursor);
      break;
    }
    out += text.slice(cursor, open);
    const json = text.slice(open + PROGRESS_OPEN.length, close);
    const parsed = parseEvent(json);
    if (parsed) events.push(parsed);
    cursor = close + PROGRESS_CLOSE.length;
  }

  // Collapse the blank lines the encoder added around each sentinel.
  out = out.replace(/\n{3,}/g, '\n\n');
  return { text: out, events };
}

function parseEvent(json: string): StudioProgressEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'phase' || kind === 'harness_ready' || kind === 'node' || kind === 'agent_calls') {
    return value as StudioProgressEvent;
  }
  return null;
}

/** A fresh, empty progress snapshot. */
export function emptyProgress(): StudioRunProgress {
  return {
    phase: 'planning',
    objective: '',
    agentCalls: 0,
    maxAgentCalls: 0,
    totalNodes: 0,
    nodes: [],
  };
}

const STATUS_RANK: Record<StudioNodeStatus, number> = {
  running: 0,
  success: 1,
  error: 1,
  interrupted: 1,
};

/**
 * Fold a batch of events onto a prior snapshot, returning a NEW snapshot
 * (never mutates `prev`). Node status is monotonic — a terminal status never
 * reverts to `running` if events arrive out of order — and `agentCalls` only
 * advances (never regresses on a late lower value).
 */
export function reduceProgress(
  prev: StudioRunProgress,
  events: StudioProgressEvent[],
): StudioRunProgress {
  if (events.length === 0) return prev;

  let phase = prev.phase;
  let objective = prev.objective;
  let agentCalls = prev.agentCalls;
  let maxAgentCalls = prev.maxAgentCalls;
  let totalNodes = prev.totalNodes;
  const nodes = prev.nodes.map((n) => ({ ...n }));
  const indexById = new Map(nodes.map((n, i) => [n.id, i] as const));

  for (const event of events) {
    switch (event.kind) {
      case 'phase':
        phase = event.phase;
        break;
      case 'harness_ready':
        totalNodes = event.totalNodes;
        maxAgentCalls = event.maxAgentCalls;
        if (event.objective) objective = event.objective;
        if (phase === 'planning') phase = 'executing';
        break;
      case 'agent_calls':
        agentCalls = Math.max(agentCalls, event.spent);
        break;
      case 'node': {
        const existingIndex = indexById.get(event.id);
        if (existingIndex === undefined) {
          indexById.set(event.id, nodes.length);
          nodes.push({
            id: event.id,
            label: event.label || event.id,
            status: event.status,
          });
        } else {
          const node = nodes[existingIndex];
          if (event.label) node.label = event.label;
          // Never demote a terminal status back to running.
          if (STATUS_RANK[event.status] >= STATUS_RANK[node.status]) {
            node.status = event.status;
          }
        }
        break;
      }
    }
  }

  return {
    phase,
    objective,
    agentCalls,
    maxAgentCalls,
    totalNodes,
    nodes,
    startedAt: prev.startedAt,
    endedAt: prev.endedAt,
  };
}

/** Count nodes by terminal/running state for the progress bar + badges. */
export function progressCounts(progress: StudioRunProgress): {
  completed: number;
  running: number;
  failed: number;
  total: number;
  percent: number;
} {
  let completed = 0;
  let running = 0;
  let failed = 0;
  for (const node of progress.nodes) {
    if (node.status === 'success') completed += 1;
    else if (node.status === 'running') running += 1;
    else failed += 1; // error | interrupted
  }
  const total = Math.max(progress.totalNodes, progress.nodes.length);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { completed, running, failed, total, percent };
}
