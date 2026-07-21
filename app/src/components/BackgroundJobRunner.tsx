import { useEffect } from 'react';
import { useStore } from '@/store/useStore';
import {
  listBackgroundJobs,
  removeBackgroundJob,
  type BackgroundJobProbeRaw,
} from '@/lib/tauri';
import {
  isBackgroundJobManifest,
  jobSessionKey,
  parseJobPercent,
  resolveJobStatus,
  type BackgroundJobManifest,
} from '@/lib/backgroundJobs';
import { workflowSessionKeyId } from '@/store/sessionKey';
import type { WorkflowSessionKey } from '@/store/storeState';
import type { RunProgressSummary } from '@/store/runProgress';

// Poll cadence. Long external jobs (video dub takes hours) don't need a tight
// loop; 3s keeps the Sidebar dot responsive without hammering the disk.
const JOB_POLL_MS = 3000;

/**
 * Turn one Rust probe into a parsed manifest, or null if the file was not a
 * valid job manifest (foreign file, corrupt JSON, wrong schema).
 */
function parseProbeManifest(
  probe: BackgroundJobProbeRaw,
): BackgroundJobManifest | null {
  let value: unknown;
  try {
    value = JSON.parse(probe.manifestJson);
  } catch {
    return null;
  }
  return isBackgroundJobManifest(value) ? value : null;
}

/** Progress summary from a job's tail; percent-only (jobs have no node count). */
function jobProgressSummary(
  manifest: BackgroundJobManifest,
  probe: BackgroundJobProbeRaw,
): RunProgressSummary {
  const percent = parseJobPercent(
    probe.progressTail ?? undefined,
    manifest.progressRegex,
  );
  return { completed: 0, incomplete: 0, percent };
}

/**
 * BackgroundJobRunner: bridges detached external processes to session live
 * status. Every tick it asks Rust to probe each workspace's
 * `.ultragamestudio/jobs/` dir, runs the pure state-machine over each manifest,
 * keeps the still-running ones in `jobSessions` (so the Sidebar dot stays
 * "running"), and deletes the terminal ones so a finished job stops re-probing
 * — letting the dot fall back to the session's own success/failed result.
 *
 * Desktop-only: `listBackgroundJobs` is a no-op (returns []) outside Tauri, so
 * this quietly does nothing in the browser dev server.
 */
export default function BackgroundJobRunner() {
  const workspaces = useStore((s) => s.workspaces);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const setBackgroundJobState = useStore((s) => s.setBackgroundJobState);

  useEffect(() => {
    let cancelled = false;

    // The set of workspace cwds to probe. Each workspace's `.ultragamestudio`
    // is a separate jobs dir. Dedupe by path; skip workspaces without one.
    const cwds = Array.from(
      new Set(
        workspaces
          .map((w) => w.path?.trim())
          .filter((p): p is string => !!p),
      ),
    );

    const poll = async () => {
      let probes: BackgroundJobProbeRaw[] = [];
      try {
        const perWorkspace = await Promise.all(
          cwds.length > 0
            ? cwds.map((cwd) => listBackgroundJobs(cwd).catch(() => []))
            : [listBackgroundJobs(null).catch(() => [])],
        );
        probes = perWorkspace.flat();
      } catch {
        return; // Never let a probe failure crash the poll loop.
      }
      if (cancelled) return;

      const sessions: WorkflowSessionKey[] = [];
      const progress: Record<string, RunProgressSummary> = {};
      const seenKeyIds = new Set<string>();
      const terminal: Array<{ cwd: string | null; fileStem: string }> = [];

      for (const probe of probes) {
        const manifest = parseProbeManifest(probe);
        if (!manifest) continue;
        const status = resolveJobStatus(manifest, {
          artifactExists: probe.artifactExists,
          doneMarkerExists: probe.doneMarkerExists,
          failMarkerExists: probe.failMarkerExists,
          pidAlive: probe.pidAlive ?? undefined,
          progressTail: probe.progressTail ?? undefined,
          probedAt: probe.probedAtMs,
        });

        if (status === 'running') {
          const key = jobSessionKey(manifest);
          const keyId = workflowSessionKeyId(key);
          if (!seenKeyIds.has(keyId)) {
            seenKeyIds.add(keyId);
            sessions.push(key);
          }
          const summary = jobProgressSummary(manifest, probe);
          // When several jobs share a session, keep the LOWEST percent so the
          // dot reflects the slowest still-running step.
          const prior = progress[keyId];
          if (
            !prior ||
            (summary.percent != null &&
              (prior.percent == null || summary.percent < prior.percent))
          ) {
            progress[keyId] = summary;
          }
        } else {
          // success | failed -> retire the manifest so it stops re-probing.
          terminal.push({
            cwd: probe.workspaceCwd,
            fileStem: probe.fileStem,
          });
        }
      }

      setBackgroundJobState(sessions, progress);

      // Fire-and-forget cleanup of finished jobs.
      for (const job of terminal) {
        void removeBackgroundJob(job.cwd, job.fileStem).catch(() => {});
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), JOB_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeWorkspaceId, setBackgroundJobState, workspaces]);

  return null;
}
