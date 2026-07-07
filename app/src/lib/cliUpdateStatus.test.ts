import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliVersionStatus } from '@/lib/tauri';

vi.mock('@/lib/tauri', () => ({
  isTauri: () => true,
  checkCliUpdates: vi.fn(),
}));

import { checkCliUpdates } from '@/lib/tauri';
import {
  getCliUpdateSnapshot,
  markCliUpdatesSeen,
  refreshCliUpdateStatus,
} from './cliUpdateStatus';

const mockCheckCliUpdates = vi.mocked(checkCliUpdates);

function statusFixture(
  overrides: Partial<CliVersionStatus> = {},
): CliVersionStatus {
  return {
    adapter: 'claude-code',
    label: 'Claude Code',
    executablePath: 'C:/claude.exe',
    installedVersion: '2.1.197',
    latestVersion: '2.1.202',
    updateAvailable: true,
    checkedAtMs: Date.now(),
    ...overrides,
  };
}

afterEach(() => {
  window.localStorage.clear();
  mockCheckCliUpdates.mockReset();
});

describe('cliUpdateStatus red-dot badge', () => {
  it('reports hasUnseenUpdate when a CLI has a pending update', async () => {
    mockCheckCliUpdates.mockResolvedValue([statusFixture()]);

    const snapshot = await refreshCliUpdateStatus();

    expect(snapshot.hasUnseenUpdate).toBe(true);
    expect(getCliUpdateSnapshot().hasUnseenUpdate).toBe(true);
  });

  it('clears the badge once the update has been marked as seen', async () => {
    mockCheckCliUpdates.mockResolvedValue([statusFixture()]);
    await refreshCliUpdateStatus();
    expect(getCliUpdateSnapshot().hasUnseenUpdate).toBe(true);

    markCliUpdatesSeen(getCliUpdateSnapshot().statuses);

    expect(getCliUpdateSnapshot().hasUnseenUpdate).toBe(false);
  });

  it('re-shows the badge when an even newer version appears after being dismissed', async () => {
    mockCheckCliUpdates.mockResolvedValue([statusFixture({ latestVersion: '2.1.202' })]);
    await refreshCliUpdateStatus();
    markCliUpdatesSeen(getCliUpdateSnapshot().statuses);
    expect(getCliUpdateSnapshot().hasUnseenUpdate).toBe(false);

    mockCheckCliUpdates.mockResolvedValue([
      statusFixture({ installedVersion: '2.1.197', latestVersion: '2.1.210' }),
    ]);
    const snapshot = await refreshCliUpdateStatus();

    expect(snapshot.hasUnseenUpdate).toBe(true);
  });

  it('does not flag the badge when every CLI is already up to date', async () => {
    mockCheckCliUpdates.mockResolvedValue([
      statusFixture({ updateAvailable: false, latestVersion: '2.1.197' }),
    ]);

    const snapshot = await refreshCliUpdateStatus();

    expect(snapshot.hasUnseenUpdate).toBe(false);
  });
});
