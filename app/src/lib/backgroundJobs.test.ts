import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_JOB_SCHEMA,
  DEFAULT_PID_DEATH_GRACE_MS,
  isBackgroundJobManifest,
  jobSessionKey,
  parseJobPercent,
  resolveJobStatus,
  type BackgroundJobManifest,
  type JobProbe,
} from './backgroundJobs';

function manifest(
  over: Partial<BackgroundJobManifest> = {},
): BackgroundJobManifest {
  return {
    schema: BACKGROUND_JOB_SCHEMA,
    id: 'job-1',
    sessionId: 'sess-1',
    workspaceId: 'ws-1',
    label: '配音合成',
    startedAt: 1000,
    done: { artifactPath: 'E:/out.mp4' },
    ...over,
  };
}

function probe(over: Partial<JobProbe> = {}): JobProbe {
  return {
    artifactExists: false,
    doneMarkerExists: false,
    failMarkerExists: false,
    probedAt: 2000,
    ...over,
  };
}

describe('parseJobPercent', () => {
  it('returns the last percent in the tail (most recent progress)', () => {
    expect(parseJobPercent('12.0% ... 44% ... 99.5%', undefined)).toBe(99.5);
  });

  it('returns null when nothing matches', () => {
    expect(parseJobPercent('no numbers here', undefined)).toBeNull();
    expect(parseJobPercent(undefined, undefined)).toBeNull();
  });

  it('ignores out-of-range values', () => {
    expect(parseJobPercent('frame=1234 999%', undefined)).toBeNull();
  });

  it('honors a custom regex with a capture group', () => {
    expect(parseJobPercent('step 3 of 10', '([0-9]+) of 10')).toBe(3);
  });

  it('falls back to default when the custom regex is malformed', () => {
    expect(parseJobPercent('50%', '([')).toBe(50);
  });
});

describe('resolveJobStatus', () => {
  it('fail marker wins over everything', () => {
    expect(
      resolveJobStatus(
        manifest(),
        probe({ failMarkerExists: true, artifactExists: true }),
      ),
    ).toBe('failed');
  });

  it('artifact presence means success', () => {
    expect(resolveJobStatus(manifest(), probe({ artifactExists: true }))).toBe(
      'success',
    );
  });

  it('done marker means success', () => {
    expect(
      resolveJobStatus(manifest(), probe({ doneMarkerExists: true })),
    ).toBe('success');
  });

  it('artifact check beats a dead pid (finish/exit race)', () => {
    // pid dead AND past grace, but the artifact landed -> success, not failed.
    expect(
      resolveJobStatus(
        manifest({ startedAt: 0 }),
        probe({ pidAlive: false, artifactExists: true, probedAt: 999_999 }),
      ),
    ).toBe('success');
  });

  it('dead pid with no artifact, past grace, is a failure', () => {
    expect(
      resolveJobStatus(
        manifest({ startedAt: 0 }),
        probe({ pidAlive: false, probedAt: DEFAULT_PID_DEATH_GRACE_MS + 1 }),
      ),
    ).toBe('failed');
  });

  it('dead pid within grace window stays running', () => {
    expect(
      resolveJobStatus(
        manifest({ startedAt: 0 }),
        probe({ pidAlive: false, probedAt: DEFAULT_PID_DEATH_GRACE_MS - 1 }),
      ),
    ).toBe('running');
  });

  it('unknown pid liveness never invents a failure', () => {
    expect(
      resolveJobStatus(
        manifest({ startedAt: 0 }),
        probe({ pidAlive: undefined, probedAt: 999_999 }),
      ),
    ).toBe('running');
  });

  it('live pid with no signal is running', () => {
    expect(resolveJobStatus(manifest(), probe({ pidAlive: true }))).toBe(
      'running',
    );
  });
});

describe('jobSessionKey', () => {
  it('projects manifest identity into the store key shape', () => {
    expect(jobSessionKey(manifest())).toEqual({
      workspaceId: 'ws-1',
      sessionId: 'sess-1',
    });
  });
});

describe('isBackgroundJobManifest', () => {
  it('accepts a well-formed manifest', () => {
    expect(isBackgroundJobManifest(manifest())).toBe(true);
  });

  it('rejects wrong schema / missing fields / non-objects', () => {
    expect(isBackgroundJobManifest({ ...manifest(), schema: 99 })).toBe(false);
    expect(isBackgroundJobManifest({ id: 'x' })).toBe(false);
    expect(isBackgroundJobManifest(null)).toBe(false);
    expect(isBackgroundJobManifest('nope')).toBe(false);
  });
});
