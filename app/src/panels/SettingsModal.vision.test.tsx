import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultBlueprint } from '@/core/defaultBlueprint';
import { loadVisionModelSettings } from '@/lib/visionModel';
import { defaultComposer } from '@/store/sampleSessions';
import { useStore } from '@/store/useStore';
import SettingsModal from './SettingsModal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('SettingsModal Vision/VLM tab', () => {
  it('shows domestic/global paid/free providers and persists a custom route', async () => {
    useStore.setState({
      locale: 'zh-CN',
      workflow: defaultBlueprint('wf'),
      composer: defaultComposer,
      activeWorkspaceId: null,
      activeSessionId: null,
      workspaces: [],
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(<SettingsModal onClose={vi.fn()} />);
      });
      const buttons = Array.from(
        container.querySelectorAll<HTMLButtonElement>('button'),
      );
      const videoTabIndex = buttons.findIndex(
        (button) => button.textContent?.trim() === '视频渠道',
      );
      const visionTabIndex = buttons.findIndex(
        (button) => button.textContent?.trim() === 'Vision/VLM',
      );
      const animationTabIndex = buttons.findIndex(
        (button) => button.textContent?.trim() === '动画渠道',
      );
      expect(visionTabIndex).toBe(videoTabIndex + 1);
      expect(animationTabIndex).toBe(visionTabIndex + 1);
      const visionTab = buttons[visionTabIndex];
      await act(async () => {
        visionTab?.click();
      });

      expect(container.textContent).toContain('OpenAI · GPT Vision');
      expect(container.textContent).toContain('阿里云百炼 · Qwen-VL');
      expect(container.textContent).toContain('收费渠道');

      const freeTab = Array.from(
        container.querySelectorAll<HTMLButtonElement>('button[role="tab"]'),
      ).find((button) => button.textContent?.trim() === '免费 / 额度');
      await act(async () => {
        freeTab?.click();
      });
      expect(container.textContent).toContain('Google AI Studio · Gemini');
      expect(container.textContent).toContain('硅基流动 · 视觉模型');
      expect(container.textContent).toContain('Ollama · 本地 VLM');

      const addButton = Array.from(
        container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent?.trim() === '添加 VLM 渠道');
      await act(async () => {
        addButton?.click();
      });
      const editor = container.querySelector<HTMLElement>(
        '[data-custom-vision-provider-editor="true"]',
      );
      expect(editor).toBeInstanceOf(HTMLElement);
      const inputs = Array.from(editor!.querySelectorAll<HTMLInputElement>('input'));
      await act(async () => {
        setInputValue(inputs.find((input) => input.placeholder === 'Custom VLM')!, '内部视觉网关');
        setInputValue(
          inputs.find((input) => input.placeholder === 'https://api.example.com/v1')!,
          'https://vlm.example.com/v1',
        );
        setInputValue(inputs.find((input) => input.placeholder === 'sk-...')!, 'sk-test');
        setInputValue(inputs.find((input) => input.placeholder === 'vision-model')!, 'vlm-pro');
      });
      const save = Array.from(editor!.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent?.trim() === '保存',
      );
      await act(async () => {
        save?.click();
      });

      expect(loadVisionModelSettings()).toMatchObject({
        preferredProviderId: expect.stringMatching(/^custom:/),
        providerKeys: expect.objectContaining({
          [loadVisionModelSettings().preferredProviderId]: 'sk-test',
        }),
      });
      expect(container.textContent).toContain('内部视觉网关');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});
