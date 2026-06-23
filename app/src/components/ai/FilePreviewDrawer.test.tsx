import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FilePreviewDrawer from './FilePreviewDrawer';
import { previewLocalFile, workspaceFileDiff } from '@/lib/tauri';

vi.mock('@/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauri')>()),
  openLocalPath: vi.fn(),
  previewLocalFile: vi.fn(),
  workspaceFileDiff: vi.fn(),
}));

describe('FilePreviewDrawer', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalCreateObjectUrl: typeof URL.createObjectURL | undefined;
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL | undefined;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    originalCreateObjectUrl = URL.createObjectURL;
    originalRevokeObjectUrl = URL.revokeObjectURL;
    vi.useRealTimers();
    vi.mocked(previewLocalFile).mockReset();
    vi.mocked(workspaceFileDiff).mockReset();
    vi.mocked(workspaceFileDiff).mockResolvedValue(null);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: originalCreateObjectUrl,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: originalRevokeObjectUrl,
    });
  });

  it('does not mount a full-screen backdrop that blocks the rest of the app', async () => {
    vi.mocked(previewLocalFile).mockReturnValue(new Promise(() => {}));

    await act(async () => {
      root.render(
        createElement(FilePreviewDrawer, {
          refData: { path: 'screen.png', basename: 'screen.png' },
          onClose: vi.fn(),
        }),
      );
    });

    expect(
      container.querySelector('button[aria-label="关闭文件预览"]'),
    ).toBeNull();
    expect(container.querySelector('aside')).not.toBeNull();
  });

  it('can expand the preview to the app window and restore drawer width', async () => {
    vi.mocked(previewLocalFile).mockResolvedValue({
      path: 'E:\\UltraGameStudio\\src\\main.ts',
      fileName: 'main.ts',
      kind: 'text',
      mime: 'text/typescript',
      sizeBytes: 18,
      truncated: false,
      text: 'console.log(1);\n',
      base64: null,
    });

    await act(async () => {
      root.render(
        createElement(FilePreviewDrawer, {
          refData: { path: 'src/main.ts', basename: 'main.ts' },
          cwd: 'E:\\UltraGameStudio',
          onClose: vi.fn(),
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    const aside = container.querySelector<HTMLElement>('aside');
    expect(aside?.style.width).not.toBe('');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="占满窗口"]')?.click();
    });

    expect(container.querySelector('button[aria-label="还原预览宽度"]')).not.toBeNull();
    expect(aside?.style.width).toBe('');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="还原预览宽度"]')?.click();
    });

    expect(container.querySelector('button[aria-label="占满窗口"]')).not.toBeNull();
    expect(aside?.style.width).not.toBe('');
  });

  it('does not read VCS diff unless explicitly enabled', async () => {
    vi.mocked(previewLocalFile).mockResolvedValue({
      path: 'E:\\UltraGameStudio\\src\\main.ts',
      fileName: 'main.ts',
      kind: 'text',
      mime: 'text/typescript',
      sizeBytes: 18,
      truncated: false,
      text: 'console.log(1);\n',
      base64: null,
    });

    await act(async () => {
      root.render(
        createElement(FilePreviewDrawer, {
          refData: { path: 'src/main.ts', basename: 'main.ts' },
          cwd: 'E:\\UltraGameStudio',
          onClose: vi.fn(),
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(workspaceFileDiff).not.toHaveBeenCalled();
  });

  it('renders custom content without reading a local file', async () => {
    await act(async () => {
      root.render(
        createElement(FilePreviewDrawer, {
          refData: null,
          customContent: {
            label: '团队详情',
            path: '游戏团队 / 技术总监',
            meta: '团队属性与 Skill',
            children: createElement('div', {}, '技术总监 Skill'),
          },
          onClose: vi.fn(),
        }),
      );
    });

    expect(previewLocalFile).not.toHaveBeenCalled();
    expect(container.textContent).toContain('团队详情');
    expect(container.textContent).toContain('游戏团队 / 技术总监');
    expect(container.textContent).toContain('技术总监 Skill');
  });

  it('renders embedded mode without a fixed overlay or resize chrome', async () => {
    await act(async () => {
      root.render(
        createElement(FilePreviewDrawer, {
          refData: null,
          customContent: {
            label: '团队详情',
            path: '游戏团队 / 技术总监',
            children: createElement('div', {}, '技术总监 Skill'),
          },
          variant: 'embedded',
          onClose: vi.fn(),
        }),
      );
    });

    expect(container.querySelector('.fixed.inset-0')).toBeNull();
    expect(container.querySelector('aside')).toBeNull();
    expect(container.querySelector('[aria-label="占满窗口"]')).toBeNull();
    expect(container.querySelector('[aria-label="拖动调整预览宽度"]')).toBeNull();
    expect(container.textContent).toContain('团队详情');
  });

  it('closes embedded mode when the user clicks outside the preview', async () => {
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        createElement(FilePreviewDrawer, {
          refData: null,
          customContent: {
            label: '团队详情',
            path: '游戏团队 / 技术总监',
            children: createElement('div', {}, '技术总监 Skill'),
          },
          variant: 'embedded',
          onClose,
        }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      container.firstElementChild?.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      document.body.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes when the user clicks outside the preview drawer', async () => {
    vi.mocked(previewLocalFile).mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        createElement(FilePreviewDrawer, {
          refData: { path: 'screen.png', basename: 'screen.png' },
          onClose,
        }),
      );
    });
    // Let the deferred listener registration run.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const aside = container.querySelector<HTMLElement>('aside');
    await act(async () => {
      aside?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders image previews through a blob URL instead of a large data URL', async () => {
    vi.useFakeTimers();
    const createObjectUrl = vi.fn(() => 'blob:preview-image');
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl,
    });
    vi.mocked(previewLocalFile).mockResolvedValue({
      path: 'E:\\UltraGameStudio\\.ultragamestudio\\clipboard-images\\screen.png',
      fileName: 'screen.png',
      kind: 'image',
      mime: 'image/png',
      sizeBytes: 3,
      truncated: false,
      text: null,
      base64: btoa('png'),
    });

    await act(async () => {
      root.render(
        createElement(FilePreviewDrawer, {
          refData: { path: 'screen.png', basename: 'screen.png' },
          onClose: vi.fn(),
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    const img = container.querySelector<HTMLImageElement>('img');
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(img?.getAttribute('src')).toBe('blob:preview-image');
    expect(img?.getAttribute('src')).not.toMatch(/^data:/);

    await act(async () => {
      root.render(
        createElement(FilePreviewDrawer, {
          refData: null,
          onClose: vi.fn(),
        }),
      );
    });
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:preview-image');
  });

  it('renders VCS diff marks for text previews', async () => {
    vi.mocked(previewLocalFile).mockResolvedValue({
      path: 'E:\\UltraGameStudio\\src\\main.ts',
      fileName: 'main.ts',
      kind: 'text',
      mime: 'text/typescript',
      sizeBytes: 32,
      truncated: false,
      text: 'const oldValue = 1;\nconst nextValue = 2;\n',
      base64: null,
    });
    vi.mocked(workspaceFileDiff).mockResolvedValue({
      path: 'src/main.ts',
      oldPath: null,
      status: 'modified',
      binary: false,
      truncated: false,
      lines: [
        {
          kind: 'replacedDeleted',
          oldLine: 2,
          newLine: null,
          content: 'const oldValue = 2;',
        },
        {
          kind: 'replacedAdded',
          oldLine: null,
          newLine: 2,
          content: 'const nextValue = 2;',
        },
      ],
    });

    await act(async () => {
      root.render(
        createElement(FilePreviewDrawer, {
          refData: { path: 'src/main.ts', basename: 'main.ts' },
          cwd: 'E:\\UltraGameStudio',
          diffEnabled: true,
          onClose: vi.fn(),
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(workspaceFileDiff).toHaveBeenCalledWith('E:\\UltraGameStudio', 'src/main.ts');
    expect(
      container.querySelector('[data-vcs-kind="replacedAdded"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-vcs-kind="replacedDeleted"]'),
    ).not.toBeNull();
    expect(container.querySelector('.ai-file-preview-diff__minimap')).not.toBeNull();
  });
});
