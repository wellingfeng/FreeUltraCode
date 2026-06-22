import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultBlueprint } from '@/core/defaultBlueprint';
import { loadImageGenerationSettings } from '@/lib/imageGeneration';
import { loadMusicGenerationSettings } from '@/lib/musicGeneration';
import { loadSpeechGenerationSettings } from '@/lib/speechGeneration';
import { loadVideoGenerationSettings } from '@/lib/videoGeneration';
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
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function openImageAddDialog(container: HTMLElement): Promise<HTMLElement> {
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
  return container.querySelector<HTMLElement>(
    '[data-custom-generation-provider-editor]',
  )!;
}

async function openImageTab(container: HTMLElement): Promise<void> {
  const imageTab = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button'),
  ).find((button) => button.textContent?.trim() === '生图渠道');
  await act(async () => {
    imageTab?.click();
  });
}

async function openSettingsTab(
  container: HTMLElement,
  label: string,
): Promise<void> {
  const tab = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button'),
  ).find((button) => button.textContent?.trim() === label);
  await act(async () => {
    tab?.click();
  });
}

function imageProviderCard(container: HTMLElement, label: string): HTMLElement {
  const card = Array.from(container.querySelectorAll<HTMLElement>('div')).find(
    (item) => {
      const title = item.querySelector<HTMLElement>(
        'span.text-sm.font-semibold.text-fg',
      );
      return (
        item.classList.contains('space-y-3') &&
        item.classList.contains('rounded-lg') &&
        item.classList.contains('bg-bg-alt') &&
        title?.textContent?.trim() === label &&
        item.querySelector<HTMLInputElement>('input[placeholder="输入自定义模型名…"]')
      );
    },
  );
  expect(card).toBeInstanceOf(HTMLElement);
  return card!;
}

function generationProviderCard(
  container: HTMLElement,
  label: string,
): HTMLElement {
  const card = Array.from(container.querySelectorAll<HTMLElement>('div')).find(
    (item) => {
      const title = item.querySelector<HTMLElement>(
        'span.text-sm.font-semibold.text-fg',
      );
      return (
        item.classList.contains('space-y-3') &&
        item.classList.contains('rounded-lg') &&
        item.classList.contains('bg-bg-alt') &&
        title?.textContent?.trim() === label &&
        item.querySelector<HTMLInputElement>('input[placeholder="输入自定义模型名…"]')
      );
    },
  );
  expect(card).toBeInstanceOf(HTMLElement);
  return card!;
}

async function addCustomModelThenSelectBuiltin(
  container: HTMLElement,
  providerLabel: string,
  customModel: string,
  builtinModel: string,
): Promise<void> {
  let card = generationProviderCard(container, providerLabel);
  const modelInput = card.querySelector<HTMLInputElement>(
    'input[placeholder="输入自定义模型名…"]',
  );
  await act(async () => {
    setInputValue(modelInput!, customModel);
  });
  const addButton = Array.from(
    card.querySelectorAll<HTMLButtonElement>('button'),
  ).find((button) => button.textContent?.trim() === '添加');
  await act(async () => {
    addButton?.click();
  });
  await act(async () => {
    await Promise.resolve();
  });

  card = generationProviderCard(container, providerLabel);
  expect(card.textContent).toContain(customModel);

  const builtinButton = Array.from(
    card.querySelectorAll<HTMLButtonElement>('button'),
  ).find((button) => button.textContent?.includes(builtinModel));
  await act(async () => {
    builtinButton?.click();
  });

  card = generationProviderCard(container, providerLabel);
  expect(card.textContent).toContain(customModel);
}

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('image channel survives modal remount', () => {
  it('still shows the custom image channel after closing and reopening Settings', async () => {
    useStore.setState({
      locale: 'zh-CN',
      workflow: defaultBlueprint('wf'),
      composer: defaultComposer,
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root = createRoot(container);

    await act(async () => {
      root.render(<SettingsModal onClose={vi.fn()} />);
    });

    const editor = await openImageAddDialog(container);
    const inputs = Array.from(editor.querySelectorAll<HTMLInputElement>('input'));
    const nameInput = inputs.find((i) => i.placeholder === '新渠道');
    const urlInput = inputs.find((i) => i.placeholder === 'https://api.example.com/v1');
    const tokenInput = inputs.find((i) => i.placeholder === 'sk-...');
    const modelInput = inputs.find((i) => i.placeholder === 'custom-image-model');

    await act(async () => {
      setInputValue(nameInput!, 'yyds');
      setInputValue(urlInput!, 'https://ai.xfws88.com');
      setInputValue(tokenInput!, 'sk-yyds');
      setInputValue(modelInput!, 'custom-image-model');
    });

    const saveButton = Array.from(
      editor.querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => b.textContent?.trim() === '保存');
    await act(async () => {
      saveButton?.click();
    });

    // Persisted right after save
    const afterSave = loadImageGenerationSettings();
    expect(afterSave.customProviders.some((p) => p.label === 'yyds')).toBe(true);

    // Close (unmount) and reopen (fresh mount) — the user's actual flow
    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);
    await act(async () => {
      root.render(<SettingsModal onClose={vi.fn()} />);
    });

    const imageTab2 = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.trim() === '生图渠道');
    await act(async () => {
      imageTab2?.click();
    });

    // The channel name should appear somewhere in the reopened panel
    expect(container.textContent).toContain('yyds');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps a manually added OpenAI image model after selecting another model', async () => {
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === 'ugs_model_list_cache_v1') {
        throw new DOMException('model cache unavailable', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    });

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

    await openImageTab(container);
    let card = imageProviderCard(container, 'OpenAI Images');
    const modelInput = card.querySelector<HTMLInputElement>(
      'input[placeholder="输入自定义模型名…"]',
    );
    await act(async () => {
      setInputValue(modelInput!, 'gpt-image-3');
    });
    const addButton = Array.from(
      card.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.trim() === '添加');
    await act(async () => {
      addButton?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    card = imageProviderCard(container, 'OpenAI Images');
    expect(card.textContent).toContain('gpt-image-3');

    const gptImage2 = Array.from(
      card.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.includes('gpt-image-2'));
    await act(async () => {
      gptImage2?.click();
    });

    card = imageProviderCard(container, 'OpenAI Images');
    expect(card.textContent).toContain('gpt-image-3');
    expect(loadImageGenerationSettings().providerModelLists['openai-image']).toContain(
      'gpt-image-3',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps manually added music, video, and speech models after selecting another model', async () => {
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === 'ugs_model_list_cache_v1') {
        throw new DOMException('model cache unavailable', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    });

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

    await openSettingsTab(container, '音乐渠道');
    await addCustomModelThenSelectBuiltin(
      container,
      'ElevenLabs Music',
      'music_v2',
      'music_v1',
    );
    expect(loadMusicGenerationSettings().providerModelLists['elevenlabs-music']).toContain(
      'music_v2',
    );

    await openSettingsTab(container, '视频渠道');
    await addCustomModelThenSelectBuiltin(
      container,
      'OpenAI Sora / Video',
      'sora-3',
      'sora-2',
    );
    expect(loadVideoGenerationSettings().providerModelLists['openai-sora']).toContain(
      'sora-3',
    );

    await openSettingsTab(container, '语音渠道');
    await addCustomModelThenSelectBuiltin(
      container,
      'OpenAI TTS',
      'gpt-4o-tts-pro',
      'gpt-4o-mini-tts',
    );
    expect(loadSpeechGenerationSettings().providerModelLists['openai-tts']).toContain(
      'gpt-4o-tts-pro',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
