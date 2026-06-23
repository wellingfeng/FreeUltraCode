import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readWorkspaceFileDiffOnDemand } from './scanHost';
import { workspaceFileDiff } from './tauri';

vi.mock('./tauri', () => ({
  workspaceFileDiff: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(workspaceFileDiff).mockReset();
});

describe('readWorkspaceFileDiffOnDemand', () => {
  it('does not touch VCS without an explicit root and file path', async () => {
    await expect(
      readWorkspaceFileDiffOnDemand({ rootPath: 'E:\\Project', path: '' }),
    ).resolves.toBeNull();

    expect(workspaceFileDiff).not.toHaveBeenCalled();
  });

  it('reads one file diff only when explicitly requested', async () => {
    vi.mocked(workspaceFileDiff).mockResolvedValue(null);

    await readWorkspaceFileDiffOnDemand({
      rootPath: ' E:\\Project ',
      path: ' src/main.ts ',
    });

    expect(workspaceFileDiff).toHaveBeenCalledWith(
      'E:\\Project',
      'src/main.ts',
    );
  });
});
