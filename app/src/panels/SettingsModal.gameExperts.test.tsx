import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsModal from './SettingsModal';
import { defaultBlueprint } from '@/core/defaultBlueprint';
import { DEFAULT_GAME_EXPERT_SETTINGS } from '@/lib/gameExperts';
import {
  installSkillFromUrl,
  isTauri,
  skillInstallTargets,
  tauriAvailable,
  uninstallSkill,
} from '@/lib/tauri';
import { defaultComposer } from '@/store/sampleSessions';
import { useStore } from '@/store/useStore';

vi.mock('@/lib/tauri', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tauri')>(
    '@/lib/tauri',
  );
  return {
    ...actual,
    installSkillFromText: vi.fn(),
    installSkillFromUrl: vi.fn(),
    isTauri: vi.fn(() => false),
    openExternal: vi.fn(),
    skillInstallTargets: vi.fn(async () => []),
    tauriAvailable: vi.fn(() => false),
    uninstallSkill: vi.fn(),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderSettingsModal(tauri = false): Promise<{
  container: HTMLDivElement;
  cleanup: () => Promise<void>;
}> {
  vi.mocked(tauriAvailable).mockReturnValue(tauri);
  vi.mocked(isTauri).mockReturnValue(tauri);
  if (!tauri) {
    vi.mocked(skillInstallTargets).mockResolvedValue([]);
  }
  useStore.setState({
    locale: 'zh-CN',
    workflow: defaultBlueprint('Current workflow'),
    composer: defaultComposer,
    gameExpertSettings: DEFAULT_GAME_EXPERT_SETTINGS,
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(<SettingsModal onClose={vi.fn()} />);
  });

  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function clickButtonByText(container: HTMLElement, text: string): Promise<void> {
  const button = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button'),
  ).find((item) => item.textContent?.trim() === text);
  expect(button).toBeInstanceOf(HTMLButtonElement);
  await act(async () => {
    button?.click();
  });
}

async function pasteInput(input: HTMLInputElement, text: string): Promise<void> {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) =>
        type === 'text/plain' || type === 'text' ? text : '',
    },
  });
  await act(async () => {
    input.dispatchEvent(event);
  });
}

async function typeInput(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  await act(async () => {
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('SettingsModal game feature navigation', () => {
  it('shows migrated game channel tabs in global settings', async () => {
    const view = await renderSettingsModal(true);

    try {
      const tabText = Array.from(
        view.container.querySelectorAll('nav [role="tab"]'),
      ).map((tab) => tab.textContent?.trim());

      expect(tabText).toContain('Mesh 渠道');
      expect(tabText).toContain('在线模型库');
      expect(tabText).toContain('Sprite');
      expect(tabText).toContain('UI 渠道');
      expect(tabText).toContain('绑定渠道');
      expect(tabText).toContain('抓帧性能');
      expect(tabText).not.toContain('游戏专家');
      expect(
        Array.from(view.container.querySelectorAll('button')).some(
          (button) => button.textContent?.trim() === '游戏专家',
        ),
      ).toBe(false);
    } finally {
      await view.cleanup();
    }
  });

  it('installs capture/performance skills to a global target', async () => {
    vi.mocked(tauriAvailable).mockReturnValue(true);
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(skillInstallTargets).mockResolvedValue([
      {
        id: 'project-codex',
        label: 'Codex 项目 Skill',
        path: 'E:\\UltraGameStudio\\.codex\\skills',
        exists: true,
        skillCount: 1,
        skills: ['renderdoc-gpu-debug'],
        isDefault: true,
        scope: 'project',
      },
      {
        id: 'global-codex',
        label: 'Codex 全局 Skill',
        path: 'C:\\Users\\FW\\.codex\\skills',
        exists: true,
        skillCount: 1,
        skills: ['renderdoc-gpu-debug'],
        isDefault: false,
        scope: 'global',
      },
    ]);
    vi.mocked(installSkillFromUrl).mockResolvedValue({
      name: 'renderdoc-gpu-debug',
      slug: 'renderdoc-gpu-debug',
      targetId: 'global-codex',
      path: 'C:\\Users\\FW\\.codex\\skills\\renderdoc-gpu-debug',
      skillFile: 'C:\\Users\\FW\\.codex\\skills\\renderdoc-gpu-debug\\SKILL.md',
      sourceUrl: 'https://github.com/rudybear/renderdoc-skill',
      overwritten: true,
    });
    vi.mocked(uninstallSkill).mockResolvedValue({
      targetId: 'global-codex',
      slug: 'renderdoc-gpu-debug',
      path: 'C:\\Users\\FW\\.codex\\skills\\renderdoc-gpu-debug',
      removed: true,
    });

    const view = await renderSettingsModal(true);

    try {
      await clickButtonByText(view.container, '抓帧性能');
      await settle();

      expect(view.container.textContent).toContain('Codex 全局 Skill');
      expect(view.container.textContent).toContain('RenderDoc GPU Debug');
      expect(view.container.textContent).toContain('v0.2.0');

      const updateButton = Array.from(
        view.container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent?.trim() === '更新');
      expect(updateButton).toBeInstanceOf(HTMLButtonElement);
      await act(async () => {
        updateButton?.click();
      });
      await settle();

      expect(installSkillFromUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: 'renderdoc-gpu-debug',
          targetId: 'global-codex',
          overwrite: true,
          projectRoot: null,
        }),
      );

      const uninstallButton = Array.from(
        view.container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent?.trim() === '卸载');
      expect(uninstallButton).toBeInstanceOf(HTMLButtonElement);
      await act(async () => {
        uninstallButton?.click();
      });
      await settle();

      expect(uninstallSkill).toHaveBeenCalledWith({
        targetId: 'global-codex',
        slug: 'renderdoc-gpu-debug',
        projectRoot: null,
      });
    } finally {
      await view.cleanup();
    }
  });

  it('shows app and game commands in the global commands tab', async () => {
    const view = await renderSettingsModal();

    try {
      await clickButtonByText(view.container, '命令');

      const commandNames = Array.from(view.container.querySelectorAll('code')).map(
        (item) => item.textContent?.trim(),
      );
      expect(commandNames).toContain('/music');
      expect(commandNames).toContain('/game');
      expect(view.container.textContent).toContain('/image-to-game');
      expect(commandNames.filter((name) => name === '/image-to-game')).toHaveLength(1);
      expect(commandNames).toContain('/mesh-mode-start');
      expect(commandNames).toContain('/sprite');
      expect(commandNames).toContain('/blueprint-mode-start');
      expect(commandNames).toContain('/ui-mode-start');
      expect(view.container.textContent).toContain('图像驱动游戏开发');
      expect(view.container.textContent).toContain(
        '从参考图、截图、文章链接或画面描述反推游戏方案、技术拆解和素材生成链路',
      );
    } finally {
      await view.cleanup();
    }
  });

  it('pastes video provider API keys into password inputs', async () => {
    const view = await renderSettingsModal();

    try {
      await clickButtonByText(view.container, '视频渠道');
      await clickButtonByText(view.container, '免费 / 本地渠道');

      const input = view.container.querySelector<HTMLInputElement>(
        'input[placeholder="r8_..."]',
      );
      expect(input).toBeInstanceOf(HTMLInputElement);

      await pasteInput(input!, 'r8_test_video_key');

      const saved = JSON.parse(
        window.localStorage.getItem('ultragamestudio.videoGeneration.v1') ?? '{}',
      );
      expect(saved.providerKeys['replicate-video']).toBe('r8_test_video_key');
    } finally {
      await view.cleanup();
    }
  });

  it('types video provider base URLs and API keys', async () => {
    const view = await renderSettingsModal();

    try {
      await clickButtonByText(view.container, '视频渠道');

      const baseUrlInput = view.container.querySelector<HTMLInputElement>(
        'input[placeholder="https://api.dev.runwayml.com/v1"]',
      );
      const keyInput = view.container.querySelector<HTMLInputElement>(
        'input[placeholder="key_..."]',
      );
      expect(baseUrlInput).toBeInstanceOf(HTMLInputElement);
      expect(keyInput).toBeInstanceOf(HTMLInputElement);

      await typeInput(baseUrlInput!, 'https://video.example.test/v1');
      await typeInput(keyInput!, 'key_test_video');

      expect(baseUrlInput!.value).toBe('https://video.example.test/v1');
      expect(keyInput!.value).toBe('key_test_video');

      const saved = JSON.parse(
        window.localStorage.getItem('ultragamestudio.videoGeneration.v1') ?? '{}',
      );
      expect(saved.providerBaseUrls.runway).toBe('https://video.example.test/v1');
      expect(saved.providerKeys.runway).toBe('key_test_video');
    } finally {
      await view.cleanup();
    }
  });

  it('keeps video inputs editable when persistence is temporarily unavailable', async () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      });
    const view = await renderSettingsModal();

    try {
      await clickButtonByText(view.container, '视频渠道');

      const keyInput = view.container.querySelector<HTMLInputElement>(
        'input[placeholder="key_..."]',
      );
      expect(keyInput).toBeInstanceOf(HTMLInputElement);

      await typeInput(keyInput!, 'key_test_video');

      expect(keyInput!.value).toBe('key_test_video');
      expect(setItem).toHaveBeenCalled();
    } finally {
      await view.cleanup();
    }
  });

  it('pastes speech provider API keys into password inputs', async () => {
    const view = await renderSettingsModal();

    try {
      await clickButtonByText(view.container, '语音渠道');

      const input = view.container.querySelector<HTMLInputElement>(
        'input[placeholder="xi-..."]',
      );
      expect(input).toBeInstanceOf(HTMLInputElement);

      await pasteInput(input!, 'xi_test_speech_key');

      const saved = JSON.parse(
        window.localStorage.getItem('ultragamestudio.speechGeneration.v1') ?? '{}',
      );
      expect(saved.providerKeys.elevenlabs).toBe('xi_test_speech_key');
    } finally {
      await view.cleanup();
    }
  });

  it('types speech provider base URLs and API keys', async () => {
    const view = await renderSettingsModal();

    try {
      await clickButtonByText(view.container, '语音渠道');

      const baseUrlInput = view.container.querySelector<HTMLInputElement>(
        'input[placeholder="https://api.elevenlabs.io/v1"]',
      );
      const keyInput = view.container.querySelector<HTMLInputElement>(
        'input[placeholder="xi-..."]',
      );
      expect(baseUrlInput).toBeInstanceOf(HTMLInputElement);
      expect(keyInput).toBeInstanceOf(HTMLInputElement);

      await typeInput(baseUrlInput!, 'https://speech.example.test/v1');
      await typeInput(keyInput!, 'xi_test_speech');

      expect(baseUrlInput!.value).toBe('https://speech.example.test/v1');
      expect(keyInput!.value).toBe('xi_test_speech');

      const saved = JSON.parse(
        window.localStorage.getItem('ultragamestudio.speechGeneration.v1') ?? '{}',
      );
      expect(saved.providerBaseUrls.elevenlabs).toBe(
        'https://speech.example.test/v1',
      );
      expect(saved.providerKeys.elevenlabs).toBe('xi_test_speech');
    } finally {
      await view.cleanup();
    }
  });

  it('keeps speech inputs editable when persistence is temporarily unavailable', async () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      });
    const view = await renderSettingsModal();

    try {
      await clickButtonByText(view.container, '语音渠道');

      const keyInput = view.container.querySelector<HTMLInputElement>(
        'input[placeholder="xi-..."]',
      );
      expect(keyInput).toBeInstanceOf(HTMLInputElement);

      await typeInput(keyInput!, 'xi_test_speech');

      expect(keyInput!.value).toBe('xi_test_speech');
      expect(setItem).toHaveBeenCalled();
    } finally {
      await view.cleanup();
    }
  });
});
