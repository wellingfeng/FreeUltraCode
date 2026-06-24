import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RemoteWorkspaceDialog from './RemoteWorkspaceDialog';
import {
  saveRemoteRunnerConnection,
  saveRemoteWorkspace,
} from '@/lib/remoteWorkspace';
import { resetSecureStorageForTests } from '@/lib/secureStorage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  resetSecureStorageForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
  resetSecureStorageForTests();
  vi.restoreAllMocks();
});

describe('RemoteWorkspaceDialog', () => {
  it('keeps server URL and access token out of the project form by default', () => {
    saveRemoteRunnerConnection(
      { serverUrl: 'https://runner.test:8787' },
      { token: 'runner-token' },
    );
    const existing = saveRemoteWorkspace({
      label: '云端游戏项目',
      serverUrl: 'https://runner.test:8787',
      projectId: 'proj_game',
      repoUrl: 'https://github.com/me/game.git',
      adapter: 'codex',
    });

    act(() => {
      root.render(
        <RemoteWorkspaceDialog
          locale="zh-CN"
          existing={existing}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain('云端服务连接');
    expect(container.textContent).toContain('已配置');
    expect(container.textContent).toContain('项目仓库地址');
    expect(container.textContent).not.toContain('服务器地址');
    expect(container.textContent).not.toContain('访问 Token');
  });

  it('shows server connection fields only after the user opens cloud service config', () => {
    act(() => {
      root.render(
        <RemoteWorkspaceDialog
          locale="zh-CN"
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />,
      );
    });

    expect(container.textContent).not.toContain('服务器地址');
    const button = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === '配置云端服务',
    );
    expect(button).toBeTruthy();

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('服务器地址');
    expect(container.textContent).toContain('访问 Token');
  });

  it('drops the project-level default model field', () => {
    saveRemoteRunnerConnection(
      { serverUrl: 'https://runner.test:8787' },
      { token: 'runner-token' },
    );
    const existing = saveRemoteWorkspace({
      label: '云端游戏项目',
      serverUrl: 'https://runner.test:8787',
      projectId: 'proj_game',
      repoUrl: 'https://github.com/me/game.git',
      adapter: 'codex',
    });

    act(() => {
      root.render(
        <RemoteWorkspaceDialog
          locale="zh-CN"
          existing={existing}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />,
      );
    });

    // 模型不再由项目级配置，运行时跟随所选服务器账号。
    expect(container.textContent).not.toContain('默认模型');
    // 「默认 Agent」仍在，并给出说明。
    expect(container.textContent).toContain('默认 Agent');
    expect(container.textContent).toContain('模型随所选账号自动匹配');
  });
});
