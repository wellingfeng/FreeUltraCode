import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  flushGenerationSettings: vi.fn(async () => undefined),
  flushRemoteProfileWrites: vi.fn(async () => undefined),
  flushSecureStorage: vi.fn(async () => undefined),
  flushSecretsToLocalStorageFallback: vi.fn(),
  flushComposerDraftPersist: vi.fn(async () => undefined),
  invoke: vi.fn(async () => undefined),
  isTauri: vi.fn(() => true),
  listen: vi.fn(async (event: string, handler: () => void) => {
    void event;
    void handler;
    return () => undefined;
  }),
}));

vi.mock('@/lib/generationSettingsStore', () => ({
  flushGenerationSettings: mocks.flushGenerationSettings,
}));
vi.mock('@/lib/settingsProfile', () => ({
  flushRemoteProfileWrites: mocks.flushRemoteProfileWrites,
}));
vi.mock('@/lib/secureStorage', () => ({
  flushSecureStorage: mocks.flushSecureStorage,
  flushSecretsToLocalStorageFallback:
    mocks.flushSecretsToLocalStorageFallback,
}));
vi.mock('@/lib/tauri', () => ({
  isTauri: mocks.isTauri,
}));
vi.mock('@/store/composerDraftPersistence', () => ({
  flushComposerDraftPersist: mocks.flushComposerDraftPersist,
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen,
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));

import { installQuitFlushHandler, resetQuitFlushForTests } from './quitFlush';

function getBeforeQuitListener(): (() => void) | undefined {
  const call = mocks.listen.mock.calls.find(
    ([event]) => event === 'ugs:before-quit',
  );
  return call?.[1] as (() => void) | undefined;
}

describe('installQuitFlushHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQuitFlushForTests();
    mocks.isTauri.mockReturnValue(true);
    mocks.listen.mockResolvedValue(() => undefined);
  });

  it('flushes secrets before allowing tray quit', async () => {
    await installQuitFlushHandler();
    expect(mocks.listen).toHaveBeenCalledWith(
      'ugs:before-quit',
      expect.any(Function),
    );

    const listener = getBeforeQuitListener();
    expect(listener).toBeTypeOf('function');
    listener?.();

    expect(mocks.flushSecretsToLocalStorageFallback).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('ugs_quit_flush_done');
    });
    expect(mocks.flushSecureStorage).toHaveBeenCalledOnce();
    expect(mocks.flushGenerationSettings).toHaveBeenCalledOnce();
    expect(mocks.flushRemoteProfileWrites).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(mocks.flushComposerDraftPersist).toHaveBeenCalledOnce();
    });
  });

  it('waits for keychain writes before allowing tray quit', async () => {
    let resolveWrite: (() => void) | undefined;
    let writeStartedResolve!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      writeStartedResolve = resolve;
    });
    const writeGate = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    mocks.flushSecureStorage.mockImplementation(async () => {
      writeStartedResolve();
      await writeGate;
    });
    await installQuitFlushHandler();
    const listener = getBeforeQuitListener();
    expect(listener).toBeTypeOf('function');

    listener?.();
    await writeStarted;
    await Promise.resolve();
    expect(mocks.invoke).not.toHaveBeenCalledWith('ugs_quit_flush_done');

    resolveWrite?.();
    await vi.waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('ugs_quit_flush_done');
    });
  });

  it('does not signal quit completion while a flush is pending', async () => {
    await installQuitFlushHandler();
    const listener = getBeforeQuitListener();
    expect(listener).toBeTypeOf('function');

    let gateResolve!: () => void;
    const gate = new Promise<void>((resolve) => {
      gateResolve = resolve;
    });
    mocks.flushSecureStorage.mockImplementation(async () => {
      await gate;
    });

    listener?.();
    await Promise.resolve();
    expect(mocks.invoke).not.toHaveBeenCalledWith('ugs_quit_flush_done');
    gateResolve();
    await vi.waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('ugs_quit_flush_done');
    });
  });
});
