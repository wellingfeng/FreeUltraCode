import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelCliCandidate, ModelCliScanResult } from '@/lib/tauri';

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  scanModelClis: vi.fn(),
  validateCliPath: vi.fn(),
}));

vi.mock('@/lib/tauri', () => ({
  isTauri: mocks.isTauri,
  scanModelClis: mocks.scanModelClis,
  validateCliPath: mocks.validateCliPath,
}));

const DSH_PATH = 'C:\\Users\\FW\\AppData\\Roaming\\npm\\dsh.cmd';

function scanResult(candidates: ModelCliCandidate[]): ModelCliScanResult {
  return {
    scannedAtMs: Date.now(),
    platform: 'windows',
    candidates,
    error: null,
  };
}

function dshCandidate(): ModelCliCandidate {
  return {
    adapter: 'deepseek-harness',
    command: 'dsh',
    path: DSH_PATH,
    source: 'scan',
    available: true,
    status: 'available',
    hint: DSH_PATH,
    platform: 'windows',
  };
}

function emptyScan(): ModelCliScanResult {
  return scanResult([]);
}

beforeEach(() => {
  window.localStorage.clear();
  // 每个用例都重新加载 cliConfig 模块，重置模块级快照 / 重扫冷却状态。
  vi.resetModules();
  mocks.isTauri.mockReset();
  mocks.scanModelClis.mockReset();
  mocks.validateCliPath.mockReset();
  mocks.isTauri.mockReturnValue(true);
  mocks.validateCliPath.mockRejectedValue(
    new Error('INVALID_CLI_PATH: 测试环境无自定义路径。'),
  );
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

async function loadCliConfig() {
  return import('./cliConfig');
}

describe('resolveCliInvocation 自动重扫兜底', () => {
  it('启动快照过期时：解析 fallback 后强制重扫一次并命中新装的 dsh', async () => {
    // 第一次扫描（应用启动时）dsh 还没装；第二次扫描（兜底重扫）已可用。
    mocks.scanModelClis
      .mockReturnValueOnce(emptyScan())
      .mockReturnValueOnce(scanResult([dshCandidate()]));

    const { resolveCliInvocation } = await loadCliConfig();
    const resolved = await resolveCliInvocation('deepseek-harness');

    expect(mocks.scanModelClis).toHaveBeenCalledTimes(2);
    expect(resolved.status).toBe('ready');
    expect(resolved.source).toBe('scan');
    expect(resolved.command).toBe(DSH_PATH);
  });

  it('CLI 确实缺失时：只重扫一次，冷却窗口内不再重复扫描', async () => {
    mocks.scanModelClis.mockReturnValue(emptyScan());

    const { resolveCliInvocation } = await loadCliConfig();

    const first = await resolveCliInvocation('deepseek-harness');
    expect(first.status).toBe('fallback');
    expect(first.command).toBe('dsh');
    expect(mocks.scanModelClis).toHaveBeenCalledTimes(2); // 初次 + 兜底重扫

    // 冷却窗口（30s）内再次解析：直接复用快照，不再触发重扫。
    const second = await resolveCliInvocation('deepseek-harness');
    expect(second.status).toBe('fallback');
    expect(mocks.scanModelClis).toHaveBeenCalledTimes(2);
  });

  it('快照已可用时：不触发多余重扫', async () => {
    mocks.scanModelClis.mockReturnValue(scanResult([dshCandidate()]));

    const { resolveCliInvocation } = await loadCliConfig();
    const resolved = await resolveCliInvocation('deepseek-harness');

    expect(resolved.status).toBe('ready');
    expect(resolved.source).toBe('scan');
    expect(resolved.command).toBe(DSH_PATH);
    expect(mocks.scanModelClis).toHaveBeenCalledTimes(1);
  });

  it('兜底重扫后仍不可用：返回原 fallback 结果', async () => {
    mocks.scanModelClis.mockReturnValue(emptyScan());

    const { resolveCliInvocation } = await loadCliConfig();
    const resolved = await resolveCliInvocation('claude-code');

    expect(resolved.status).toBe('fallback');
    expect(resolved.command).toBe('claude');
    expect(mocks.scanModelClis).toHaveBeenCalledTimes(2);
  });
});
