// Background job tracking — the contract that lets a long-running external
// process (yt-dlp / whisper / ffmpeg spawned with nohup/detached) surface its
// real progress in the session's live status, instead of the Sidebar dot going
// "success" the moment the CLI *turn* ends while the actual work keeps running.
//
// The problem this solves: `sessionLiveStatus` only knew about run/AI-edit
// channels, whose lifetime == "the CLI is streaming this turn". A detached
// child outlives that turn and is invisible to the store, so the green dot lied.
//
// This module is PURE (no fs / no tauri): it defines the on-disk manifest shape
// and the state-machine that decides, from a manifest + a filesystem probe,
// whether a job is still running, finished, or failed. The side-effecting parts
// (scanning `.ultragamestudio/jobs/`, tailing progress files, checking pid
// liveness, checking artifact existence) live in the Rust `jobs` command and
// the `BackgroundJobRunner` component; both feed their observations back here.
import type { WorkflowSessionKey } from '@/store/storeState';

/** Manifest version — bump when the on-disk shape changes incompatibly. */
export const BACKGROUND_JOB_SCHEMA = 1 as const;

/** Directory (under a workspace's `.ultragamestudio`) that holds job manifests. */
export const BACKGROUND_JOBS_DIR = 'jobs';

/**
 * How a job decides it is DONE. Evaluated in priority order by
 * {@link resolveJobStatus}: an explicit done-marker or a produced artifact is
 * authoritative *success*; a dead pid with neither is a *failure* (the process
 * exited without producing what it promised). This ordering matters — a process
 * can legitimately exit (pid gone) right as it finishes, so we must check the
 * artifact/marker BEFORE concluding failure from pid death.
 */
export interface JobDoneCondition {
  /** Absolute path to the final artifact; its existence means success. */
  artifactPath?: string;
  /** Absolute path to a marker file the job touches on clean completion. */
  doneMarkerPath?: string;
  /** Absolute path to a marker file the job touches on failure. */
  failMarkerPath?: string;
}

/** The on-disk manifest a background job writes to announce itself. */
export interface BackgroundJobManifest {
  schema: typeof BACKGROUND_JOB_SCHEMA;
  /** Stable id (also the manifest filename stem). */
  id: string;
  /** Session this job's progress should surface under. */
  sessionId: string | null;
  workspaceId: string | null;
  /** Short human label shown in the Sidebar tooltip / status line. */
  label: string;
  /** OS pid of the detached process, for liveness checks. */
  pid?: number;
  /** Absolute path to a text/log file whose tail carries a percentage. */
  progressFile?: string;
  /**
   * Regex source (matched case-insensitively) with ONE capture group that
   * yields a 0-100 number. Defaults to a yt-dlp/ffmpeg style `NN.N%` scan.
   */
  progressRegex?: string;
  done: JobDoneCondition;
  /** Unix ms the job was registered. */
  startedAt: number;
  /**
   * Grace period (ms) after pid death before a job with no artifact/marker is
   * declared failed. Absorbs the race where the artifact write lands just after
   * the process exits. Defaults to {@link DEFAULT_PID_DEATH_GRACE_MS}.
   */
  pidDeathGraceMs?: number;
}

export type BackgroundJobStatus = 'running' | 'success' | 'failed';

/** A filesystem probe of one job, gathered by the Rust side. */
export interface JobProbe {
  /** Whether {@link JobDoneCondition.artifactPath} currently exists. */
  artifactExists: boolean;
  /** Whether {@link JobDoneCondition.doneMarkerPath} currently exists. */
  doneMarkerExists: boolean;
  /** Whether {@link JobDoneCondition.failMarkerPath} currently exists. */
  failMarkerExists: boolean;
  /** Whether the manifest's pid is still a live process. Undefined = unknown. */
  pidAlive?: boolean;
  /** Tail of the progress file, if one was configured and readable. */
  progressTail?: string;
  /** Unix ms of this probe (used against the pid-death grace window). */
  probedAt: number;
}

/** Default: 8s of grace after pid death before calling a job failed. */
export const DEFAULT_PID_DEATH_GRACE_MS = 8000;

/** Default progress scanner: last `NN` or `NN.N` immediately before a `%`. */
const DEFAULT_PROGRESS_REGEX = '([0-9]{1,3}(?:\\.[0-9]+)?)%';

/**
 * Extract a 0-100 percent from a progress tail using the job's regex (or the
 * default). Returns the LAST match in the tail (most recent progress line) so a
 * log that accumulates `12%...44%...frame=...99%` reports 99, not 12. Returns
 * null when nothing matches or the value is out of range.
 */
export function parseJobPercent(
  tail: string | undefined,
  regexSource: string | undefined,
): number | null {
  if (!tail) return null;
  let re: RegExp;
  try {
    re = new RegExp(regexSource || DEFAULT_PROGRESS_REGEX, 'gi');
  } catch {
    // A malformed user regex must not crash the runner; fall back to default.
    re = new RegExp(DEFAULT_PROGRESS_REGEX, 'gi');
  }
  let last: number | null = null;
  for (const match of tail.matchAll(re)) {
    const raw = match[1] ?? match[0];
    const value = Number.parseFloat(raw);
    if (Number.isFinite(value) && value >= 0 && value <= 100) {
      last = value;
    }
  }
  return last;
}

/**
 * The core state machine. Decides a job's status from its manifest + a probe.
 *
 * Priority (see {@link JobDoneCondition}):
 *   1. fail marker present            -> failed
 *   2. artifact OR done marker present -> success
 *   3. pid known-dead past grace, and no success signal -> failed
 *   4. otherwise -> running
 *
 * When pid liveness is unknown (probe couldn't check), we never *invent* a
 * failure — the job stays running until a real success/fail signal lands, so an
 * unreadable pid can't spuriously flip the dot.
 */
export function resolveJobStatus(
  manifest: BackgroundJobManifest,
  probe: JobProbe,
): BackgroundJobStatus {
  if (probe.failMarkerExists) return 'failed';
  if (probe.artifactExists || probe.doneMarkerExists) return 'success';

  if (probe.pidAlive === false) {
    const grace = manifest.pidDeathGraceMs ?? DEFAULT_PID_DEATH_GRACE_MS;
    const age = probe.probedAt - manifest.startedAt;
    // Only fail once we're past the grace window AND the job has had a moment to
    // exist — a manifest probed the instant after registration with a
    // never-started pid shouldn't fail on the first tick.
    if (age >= grace) return 'failed';
  }
  return 'running';
}

/** The session this job belongs to, in the store's key shape. */
export function jobSessionKey(
  manifest: BackgroundJobManifest,
): WorkflowSessionKey {
  return {
    workspaceId: manifest.workspaceId,
    sessionId: manifest.sessionId,
  };
}

/** Type guard for a raw parsed manifest, tolerant of forward-compatible fields. */
export function isBackgroundJobManifest(
  value: unknown,
): value is BackgroundJobManifest {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.schema === BACKGROUND_JOB_SCHEMA &&
    typeof v.id === 'string' &&
    typeof v.label === 'string' &&
    typeof v.startedAt === 'number' &&
    typeof v.done === 'object' &&
    v.done !== null
  );
}
