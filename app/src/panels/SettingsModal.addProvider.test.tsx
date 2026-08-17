import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultBlueprint } from '@/core/defaultBlueprint';
import { listProviders, PROVIDERS_STORAGE } from '@/lib/apiConfig';
import { loadImageGenerationSettings } from '@/lib/imageGeneration';
import { listGatewayRunOptions } from '@/lib/modelGateway/resolver';
import { defaultComposer } from '@/store/sampleSessions';
import { useStore } from '@/store/useStore';
import SettingsModal from './SettingsModal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(input, 'value')?.set;
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(input, value);
  } else {
    valueSetter?.call(input, value);
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('SettingsModal default channel add', () => {
  it('keeps the provider editor open when the backdrop is clicked', async () => {
    window.localStorage.setItem(PROVIDERS_STORAGE, JSON.stringify([]));
    useStore.setState({
      locale: 'zh-CN',
      workflow: defaultBlueprint('wf'),
      composer: defaultComposer,
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const onClose = vi.fn();

    try {
      await act(async () => {
        root.render(<SettingsModal onClose={onClose} />);
      });

      const codingTab = Array.from(
        container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent?.trim() === '编程渠道');
      await act(async () => {
        codingTab?.click();
      });

      const addButton = Array.from(
        container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent?.trim() === '添加渠道');
      await act(async () => {
        addButton?.click();
      });

      const editor = container.querySelector<HTMLElement>('[data-provider-editor]');
      expect(editor).not.toBeNull();
      const backdrop = editor!.parentElement as HTMLDivElement;

      await act(async () => {
        backdrop.click();
      });

      expect(onClose).not.toHaveBeenCalled();
      expect(container.querySelector('[data-provider-editor]')).not.toBeNull();

      const closeButton = editor!.querySelector<HTMLButtonElement>(
        'button[aria-label="关闭"]',
      );
      expect(closeButton).toBeInstanceOf(HTMLButtonElement);
      await act(async () => {
        closeButton?.click();
      });

      expect(container.querySelector('[data-provider-editor]')).toBeNull();
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('shows a manually added coding channel after saving', async () => {
    window.localStorage.setItem(PROVIDERS_STORAGE, JSON.stringify([]));
    useStore.setState({
      locale: 'zh-CN',
      workflow: defaultBlueprint('wf'),
      composer: defaultComposer,
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<SettingsModal onClose={vi.fn()} />);
    });

    const codingTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.trim() === '编程渠道');
    await act(async () => {
      codingTab?.click();
    });

    const addButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.trim() === '添加渠道');
    await act(async () => {
      addButton?.click();
    });

    const editor = container.querySelector<HTMLElement>('[data-provider-editor]');
    expect(editor).not.toBeNull();

    const inputs = Array.from(editor!.querySelectorAll<HTMLInputElement>('input'));
    const nameInput = inputs.find((input) => input.value === '新渠道');
    const baseUrlInput = inputs.find(
      (input) => input.placeholder === 'https://api.anthropic.com',
    );
    const modelInput = inputs.find(
      (input) => input.placeholder === '搜索或输入自定义模型名…',
    );
    const apiKeyInput = editor!.querySelector<HTMLInputElement>('#provider-api-key');

    await act(async () => {
      setInputValue(nameInput!, '测试渠道');
      setInputValue(baseUrlInput!, 'https://api.example.com/v1');
      setInputValue(modelInput!, 'test-model');
      setInputValue(apiKeyInput!, 'sk-test');
    });

    // The model field is an editable combobox: type a name then click 选中/添加.
    const addModelButton = Array.from(
      editor!.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.trim() === '选中/添加');
    await act(async () => {
      addModelButton?.click();
    });

    const saveButton = Array.from(
      editor!.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.trim() === '保存');
    await act(async () => {
      saveButton?.click();
    });

    expect(listProviders()).toEqual([
      expect.objectContaining({
        name: '测试渠道',
        apiKey: 'sk-test',
        baseUrl: 'https://api.example.com/v1',
        model: 'test-model',
      }),
    ]);
    expect(container.textContent).toContain('测试渠道');
    expect(
      listGatewayRunOptions().some((option) => option.providerName === '测试渠道'),
    ).toBe(true);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('saves a manually added image generation channel', async () => {
    useStore.setState({
      locale: 'zh-CN',
      workflow: defaultBlueprint('wf'),
      composer: defaultComposer,
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<SettingsModal onClose={vi.fn()} />);
    });

    const imageTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.trim() === '生图渠道');
    await act(async () => {
      imageTab?.click();
    });

    const addButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.trim() === '添加渠道');
    await act(async () => {
      addButton?.click();
    });

    const editor = container.querySelector<HTMLElement>(
      '[data-custom-generation-provider-editor]',
    );
    expect(editor).not.toBeNull();

    const inputs = Array.from(editor!.querySelectorAll<HTMLInputElement>('input'));
    const nameInput = inputs.find((input) => input.placeholder === '新渠道');
    const urlInput = inputs.find((input) => input.placeholder === 'https://api.example.com/v1');
    const tokenInput = inputs.find((input) => input.placeholder === 'sk-...');
    const modelInput = inputs.find((input) => input.placeholder === 'custom-image-model');

    await act(async () => {
      setInputValue(nameInput!, '测试生图渠道');
      setInputValue(urlInput!, 'https://images.example.com/v1');
      setInputValue(tokenInput!, 'sk-image');
      setInputValue(modelInput!, 'image-model');
    });

    const saveButton = Array.from(
      editor!.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.trim() === '保存');
    await act(async () => {
      saveButton?.click();
    });

    const settings = loadImageGenerationSettings();
    expect(settings.customProviders).toEqual([
      expect.objectContaining({
        label: '测试生图渠道',
        defaultBaseUrl: 'https://images.example.com/v1',
        defaultModel: 'image-model',
      }),
    ]);
    expect(settings.providerKeys[settings.preferredProviderId]).toBe('sk-image');
    expect(container.textContent).toContain('测试生图渠道');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('disables save and does not persist when the image channel URL is empty', async () => {
    useStore.setState({
      locale: 'zh-CN',
      workflow: defaultBlueprint('wf'),
      composer: defaultComposer,
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<SettingsModal onClose={vi.fn()} />);
    });

    const imageTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.trim() === '生图渠道');
    await act(async () => {
      imageTab?.click();
    });

    const addButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.trim() === '添加渠道');
    await act(async () => {
      addButton?.click();
    });

    const editor = container.querySelector<HTMLElement>(
      '[data-custom-generation-provider-editor]',
    );
    expect(editor).not.toBeNull();

    const before = loadImageGenerationSettings().customProviders.length;

    const saveButton = Array.from(
      editor!.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.trim() === '保存');
    expect(saveButton?.disabled).toBe(true);

    await act(async () => {
      saveButton?.click();
    });

    expect(loadImageGenerationSettings().customProviders.length).toBe(before);
    expect(
      container.querySelector('[data-custom-generation-provider-editor]'),
    ).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
