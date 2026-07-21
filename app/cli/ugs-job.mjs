#!/usr/bin/env node
// ugs-job — register a long-running external command as an UltraGameStudio
// background job so its real progress surfaces on the session's Sidebar dot,
// instead of the dot going green the moment the CLI turn that launched it ends.
//
// WHY THIS EXISTS
//   The desktop app tracks "is this session busy?" from the lifetime of the CLI
//   *turn*. A process the agent detaches (yt-dlp / whisper / ffmpeg) outlives
//   that turn and is invisible to the app. This wrapper writes a manifest the
//   app polls (see app/src/lib/backgroundJobs.ts + BackgroundJobRunner.tsx), so
//   the session stays "running" until the wrapped command actually finishes.
//
// USAGE (the agent runs this, NOT the raw command, when backgrounding work)
//   node ugs-job.mjs --label "视频配音" --artifact "E:/out/final.mp4" \
//                    --progress "E:/out/run.log" -- <command> [args...]
//
// It runs <command> as a child, writes the manifest with the child's pid, then
// waits. On the child exiting it writes a done-marker (exit 0) or fail-marker
// (non-zero) next to the manifest — authoritative terminal signals the app
// prefers over pid-liveness guessing. Its own exit code mirrors the child's.
//
// SESSION BINDING
//   sessionId  <- --session  | env UGS_SESSION_ID
//   workspaceId<- --workspace | env UGS_WORKSPACE_ID
//   jobs dir   <- <cwd>/.ultragamestudio/jobs, where cwd is
//                 --cwd | env UGS_WORKSPACE_CWD | process.cwd()
//
// Pure Node, zero deps, so it can be launched from any shell the agent has.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, closeSync, openSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';

const SCHEMA = 1;

function parseArgs(argv) {
  const opts = {
    label: '',
    artifact: undefined,
    progress: undefined,
    progressRegex: undefined,
    session: process.env.UGS_SESSION_ID || null,
    workspace: process.env.UGS_WORKSPACE_ID || null,
    cwd: process.env.UGS_WORKSPACE_CWD || process.cwd(),
    id: undefined,
  };
  let i = 0;
  const rest = [];
  for (; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') {
      rest.push(...argv.slice(i + 1));
      break;
    }
    const take = () => argv[(i += 1)];
    switch (a) {
      case '--label': opts.label = take(); break;
      case '--artifact': opts.artifact = take(); break;
      case '--progress': opts.progress = take(); break;
      case '--progress-regex': opts.progressRegex = take(); break;
      case '--session': opts.session = take(); break;
      case '--workspace': opts.workspace = take(); break;
      case '--cwd': opts.cwd = take(); break;
      case '--id': opts.id = take(); break;
      default:
        // First bare token with no `--` starts the command (lenient form).
        rest.push(...argv.slice(i));
        i = argv.length;
        break;
    }
  }
  return { opts, command: rest };
}

function jobId(explicit) {
  if (explicit) return explicit;
  const rand = Math.random().toString(36).slice(2, 8);
  return `job-${Date.now().toString(36)}-${rand}`;
}

function main() {
  const { opts, command } = parseArgs(process.argv.slice(2));
  if (command.length === 0) {
    process.stderr.write(
      'ugs-job: 缺少要运行的命令。用法: ugs-job [选项] -- <命令> [参数...]\n',
    );
    process.exit(2);
  }

  const jobsDir = join(opts.cwd, '.ultragamestudio', 'jobs');
  mkdirSync(jobsDir, { recursive: true });

  const id = jobId(opts.id);
  const manifestPath = join(jobsDir, `${id}.json`);
  const doneMarker = join(jobsDir, `${id}.done`);
  const failMarker = join(jobsDir, `${id}.fail`);

  // Launch the wrapped command detached-in-spirit but still parented here so we
  // can observe its exit and write authoritative terminal markers.
  const child = spawn(command[0], command.slice(1), {
    cwd: opts.cwd,
    stdio: 'inherit',
    shell: false,
  });

  const manifest = {
    schema: SCHEMA,
    id,
    sessionId: opts.session,
    workspaceId: opts.workspace,
    label: opts.label || command.join(' ').slice(0, 80),
    pid: child.pid,
    progressFile:
      opts.progress && isAbsolute(opts.progress)
        ? opts.progress
        : opts.progress
          ? join(opts.cwd, opts.progress)
          : undefined,
    progressRegex: opts.progressRegex,
    done: {
      artifactPath: opts.artifact,
      doneMarkerPath: doneMarker,
      failMarkerPath: failMarker,
    },
    startedAt: Date.now(),
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  const touch = (p) => {
    try {
      closeSync(openSync(p, 'w'));
    } catch {
      /* best-effort marker; the app also falls back to artifact/pid checks */
    }
  };

  child.on('error', (err) => {
    process.stderr.write(`ugs-job: 启动子进程失败: ${err.message}\n`);
    touch(failMarker);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (code === 0) {
      touch(doneMarker);
      process.exit(0);
    } else {
      touch(failMarker);
      process.exit(code == null ? 1 : code);
    }
    void signal;
  });
}

main();
