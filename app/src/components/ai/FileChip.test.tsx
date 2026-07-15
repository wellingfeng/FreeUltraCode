import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLocalPath, previewLocalFile } from '@/lib/tauri';
import { useStore } from '@/store/useStore';
import { VisibleFileChip } from './FileChip';

vi.mock('@/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauri')>()),
  openLocalPath: vi.fn(),
  previewLocalFile: vi.fn(),
}));

describe('VisibleFileChip', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useStore.setState({ locale: 'zh-CN' });
    vi.mocked(openLocalPath).mockReset();
    vi.mocked(openLocalPath).mockResolvedValue(true);
    vi.mocked(previewLocalFile).mockReset();
    vi.mocked(previewLocalFile).mockRejectedValue(new Error('thumbnail unavailable'));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('opens TypeScript files in the in-app text preview without invoking the OS', async () => {
    const onOpenFile = vi.fn();

    await act(async () => {
      root.render(
        <VisibleFileChip
          refData={{ path: 'app/src/components/ai/FileChip.tsx', basename: 'FileChip.tsx' }}
          cwd="E:\\UltraGameStudio"
          onOpenFile={onOpenFile}
        />,
      );
    });

    const chip = container.querySelector<HTMLButtonElement>('.ai-file-chip');
    expect(chip).not.toBeNull();

    await act(async () => chip!.click());

    expect(onOpenFile).toHaveBeenCalledWith({
      path: 'app/src/components/ai/FileChip.tsx',
      basename: 'FileChip.tsx',
    });
    expect(openLocalPath).not.toHaveBeenCalled();
  });

  it('opens clipboard images in the in-app preview without invoking the OS', async () => {
    const onOpenFile = vi.fn();
    const refData = {
      path: 'E:\\UltraGameStudio\\.ultragamestudio\\clipboard-images\\screen.png',
      basename: 'screen.png',
    };

    await act(async () => {
      root.render(
        <VisibleFileChip
          refData={refData}
          cwd="E:\\UltraGameStudio"
          onOpenFile={onOpenFile}
        />,
      );
    });

    const chip = container.querySelector<HTMLButtonElement>(
      'button.ai-file-chip-thumb, button.ai-file-chip',
    );
    expect(chip).not.toBeNull();

    await act(async () => chip!.click());

    expect(onOpenFile).toHaveBeenCalledWith(refData);
    expect(openLocalPath).not.toHaveBeenCalled();
  });
});
