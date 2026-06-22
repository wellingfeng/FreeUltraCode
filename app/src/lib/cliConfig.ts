import { RUNTIME_ADAPTERS, type RuntimeAdapterId } from '@/lib/adapters';
import {
  isTauri,
  scanModelClis,
  validateCliPath,
  type CliPathValidation,
  type ModelCliCandidate,
  type ModelCliScanResult,
} from '@/lib/tauri';
import { historyStore } from '@/store/history/store';
import type {
  CliPlatform,
  CliMigrationNotice,
  CliSelection,
  CliSelectionConfig,
  CliStoredCustomPath,
} from '@/store/history/types';

export type CliCandidateSource = 'scan' | 'custom';
export type CliCandidateStatus =
  | 'available'
  | 'missing'
  | 'permission-denied'
  | 'not-executable'
  | 'unsupported'
  | 'invalid';

export interface CliCandidate {
  id: string;
  adapter: RuntimeAdapterId;
  command: string;
  path?: string;
  normalizedPath?: string;
  source: CliCandidateSource;
  status: CliCandidateStatus;
  hint?: string;
  error?: string;
  platform?: CliPlatform;
  addedAt?: string;
  lastSeenAt?: string;
}

export interface CliRuntimeSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'error';
  config: CliSelectionConfig;
  candidates: CliCandidate[];
  scannedAtMs?: number;
  error?: string;
}

export interface CliInvocation {
  adapter: RuntimeAdapterId;
  command: string;
  status: 'ready' | 'fallback' | 'invalid';
  source: 'selected' | 'custom' | 'scan' | 'fallback';
  candidate?: CliCandidate;
  error?: string;
}

const CLI_SCHEMA_VERSION = 1 as const;
const LEGACY_CLI_PATH_STORAGE = 'ugs_cli_path';
const LEGACY_CLI_COMMAND_STORAGE = 'ugs_cli_command';
const LEGACY_SELECTED_CLI_STORAGE = 'ugs_selected_cli';
const LEGACY_CLI_ADAPTER_STORAGE = 'ugs_cli_adapter';

let rawScan: ModelCliScanResult | null = null;
let runtimePromise: Promise<CliRuntimeSnapshot> | null = null;
let snapshot: CliRuntimeSnapshot = {
  status: 'idle',
  config: defaultCliConfig(),
  candidates: [],
};
const listeners = new Set<(next: CliRuntimeSnapshot) => void>();

export function adapterDefaultCommand(adapter: RuntimeAdapterId): string {
  if (adapter === 'codex') return 'codex';
  if (adapter === 'gemini') return 'gemini';
  return 'claude';
}

export function getCliRuntimeSnapshot(): CliRuntimeSnapshot {
  return snapshot;
}

export function subscribeCliRuntime(
  listener: (next: CliRuntimeSnapshot) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function primeCliRuntime(): Promise<CliRuntimeSnapshot> {
  if (runtimePromise) return runtimePromise;
  if (snapshot.status === 'ready' || snapshot.status === 'error') {
    return Promise.resolve(snapshot);
  }
  runtimePromise = rebuildCliRuntime(false).finally(() => {
    runtimePromise = null;
  });
  return runtimePromise;
}

export function refreshCliRuntime(): Promise<CliRuntimeSnapshot> {
  rawScan = null;
  runtimePromise = rebuildCliRuntime(true).finally(() => {
    runtimePromise = null;
  });
  return runtimePromise;
}

export async function resolveCliInvocation(
  adapterValue: string | undefined,
): Promise<CliInvocation> {
  const adapter = normalizeAdapter(adapterValue);
  const runtime = await primeCliRuntime();
  const selected = runtime.config.selected;

  if (selected.kind === 'path' && selected.adapter === adapter) {
    const candidate = findPathCandidate(runtime, adapter, selected.normalizedPath);
    if (candidate?.status === 'available') {
      return {
        adapter,
        command: candidate.path ?? selected.path,
        status: 'ready',
        source: 'selected',
        candidate,
      };
    }
    return {
      adapter,
      command: selected.path,
      status: 'invalid',
      source: 'selected',
      candidate,
      error:
        candidate?.error ??
        '该 CLI 路径不可用，请到「设置 > 通用 > CLI」重新选择。',
    };
  }

  if (selected.kind === 'known' && selected.adapter === adapter) {
    const candidate = runtime.candidates.find(
      (item) =>
        item.source === 'scan' &&
        item.adapter === adapter &&
        item.command === selected.command &&
        item.status === 'available',
    );
    if (candidate) {
      return {
        adapter,
        command: candidate.path ?? candidate.command,
        status: 'ready',
        source: 'selected',
        candidate,
      };
    }
  }

  const custom = latestAvailableCustomCandidate(runtime, adapter);
  if (custom) {
    return {
      adapter,
      command: custom.path ?? custom.command,
      status: 'ready',
      source: 'custom',
      candidate: custom,
    };
  }

  const scan = firstAvailableScanCandidate(runtime, adapter);
  if (scan) {
    return {
      adapter,
      command: scan.path ?? scan.command,
      status: 'ready',
      source: 'scan',
      candidate: scan,
    };
  }

  return {
    adapter,
    command: adapterDefaultCommand(adapter),
    status: 'fallback',
    source: 'fallback',
  };
}

export function isCliAdapterAvailable(
  adapterValue: string | undefined,
  runtime: CliRuntimeSnapshot = snapshot,
): boolean {
  const adapter = normalizeAdapter(adapterValue);
  return runtime.candidates.some(
    (candidate) =>
      candidate.adapter === adapter && candidate.status === 'available',
  );
}

export function selectedCliCandidateId(
  runtime: CliRuntimeSnapshot,
): string | null {
  const selected = runtime.config.selected;
  if (selected.kind === 'known') {
    return (
      runtime.candidates.find(
        (candidate) =>
          candidate.adapter === selected.adapter &&
          candidate.command === selected.command,
      )?.id ?? null
    );
  }
  if (selected.kind === 'path') {
    return (
      findPathCandidate(runtime, selected.adapter, selected.normalizedPath)?.id ??
      null
    );
  }
  return null;
}

export async function saveCliCandidateSelection(
  candidate: CliCandidate,
): Promise<CliRuntimeSnapshot> {
  if (candidate.status !== 'available') {
    throw new Error(candidate.error || '该 CLI 路径不可用，请重新选择。');
  }

  const current = await loadCliConfig();
  const selectedAt = new Date().toISOString();
  const next: CliSelectionConfig =
    candidate.source === 'scan'
      ? {
          schemaVersion: CLI_SCHEMA_VERSION,
          selected: {
            kind: 'known',
            adapter: candidate.adapter,
            command: candidate.command,
            selectedAt,
            ...(candidate.path ? { pathHint: candidate.path } : {}),
            ...(candidate.platform ? { platform: candidate.platform } : {}),
          },
          customPaths: current.customPaths,
        }
      : {
          schemaVersion: CLI_SCHEMA_VERSION,
          selected: {
            kind: 'path',
            adapter: candidate.adapter,
            path: candidate.path ?? candidate.command,
            normalizedPath:
              candidate.normalizedPath ?? candidate.path ?? candidate.command,
            selectedAt,
            platform: candidate.platform ?? frontendPlatform(),
          },
          customPaths: upsertCustomPath(current.customPaths, {
            adapter: candidate.adapter,
            path: candidate.path ?? candidate.command,
            normalizedPath:
              candidate.normalizedPath ?? candidate.path ?? candidate.command,
            platform: candidate.platform ?? frontendPlatform(),
            addedAt: candidate.addedAt ?? selectedAt,
            lastSeenAt: selectedAt,
          }),
        };

  return saveCliConfig(next);
}

export async function saveCustomCliPathSelection(
  adapterValue: string | undefined,
  validation: CliPathValidation,
): Promise<CliRuntimeSnapshot> {
  const adapter = normalizeAdapter(adapterValue);
  const current = await loadCliConfig();
  const selectedAt = new Date().toISOString();
  const custom: CliStoredCustomPath = {
    adapter,
    path: validation.path,
    normalizedPath: validation.normalizedPath,
    platform: validation.platform,
    addedAt: selectedAt,
    lastSeenAt: selectedAt,
  };
  const next: CliSelectionConfig = {
    schemaVersion: CLI_SCHEMA_VERSION,
    selected: {
      kind: 'path',
      adapter,
      path: validation.path,
      normalizedPath: validation.normalizedPath,
      selectedAt,
      platform: validation.platform,
    },
    customPaths: upsertCustomPath(current.customPaths, custom),
  };
  return saveCliConfig(next);
}

async function saveCliConfig(
  next: CliSelectionConfig,
): Promise<CliRuntimeSnapshot> {
  await historyStore.patchConfig({ cli: next });
  snapshot = { ...snapshot, config: next };
  emit();
  return refreshCliRuntimeFromCache();
}

async function refreshCliRuntimeFromCache(): Promise<CliRuntimeSnapshot> {
  runtimePromise = rebuildCliRuntime(false).finally(() => {
    runtimePromise = null;
  });
  return runtimePromise;
}

async function rebuildCliRuntime(forceScan: boolean): Promise<CliRuntimeSnapshot> {
  snapshot = { ...snapshot, status: 'loading', error: undefined };
  emit();

  let config = defaultCliConfig();
  let error: string | undefined;
  try {
    config = await loadCliConfig();
  } catch (err) {
    error = errorMessage(err);
  }

  let scan = rawScan;
  if (forceScan || !scan) {
    if (isTauri()) {
      try {
        scan = await scanModelClis();
        rawScan = scan;
        if (scan.error) error = scan.error;
      } catch (err) {
        error = errorMessage(err);
        rawScan = null;
        scan = null;
      }
    } else {
      rawScan = null;
      scan = null;
    }
  }

  const candidates = await buildCandidates(scan?.candidates ?? [], config);
  snapshot = {
    status: error ? 'error' : 'ready',
    config,
    candidates,
    scannedAtMs: scan?.scannedAtMs,
    ...(error ? { error } : {}),
  };
  emit();
  return snapshot;
}

async function loadCliConfig(): Promise<CliSelectionConfig> {
  return loadCliConfigInternal().then((result) => result.config);
}

async function loadCliConfigInternal(): Promise<{
  config: CliSelectionConfig;
}> {
  const rootConfig = await historyStore.getConfig();
  const stored = normalizeCliConfig(rootConfig.cli);
  if (stored) return { config: stored };

  const legacy = await migrateLegacyCliConfig(rootConfig);
  if (legacy) return legacy;

  return { config: defaultCliConfig() };
}

async function migrateLegacyCliConfig(
  rootConfig: Awaited<ReturnType<typeof historyStore.getConfig>>,
): Promise<{ config: CliSelectionConfig } | null> {
  const sources = collectLegacyCliSources(rootConfig);
  if (sources.length === 0) return null;

  let fallback: CliSelectionConfig | null = null;

  for (const source of sources) {
    const resolved = await resolveLegacyCliSource(source);
    if (!resolved) continue;
    if (resolved.notice) {
      fallback ??= resolved.config;
      continue;
    }

    const migrated = await persistMigratedCliConfig(resolved.config);
    return { config: migrated };
  }

  if (fallback) {
    const migrated = await persistMigratedCliConfig(fallback);
    return { config: migrated };
  }

  return null;
}

async function persistMigratedCliConfig(
  config: CliSelectionConfig,
): Promise<CliSelectionConfig> {
  await historyStore.patchConfig({ cli: config });
  return config;
}

function normalizeCliConfig(value: unknown): CliSelectionConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Partial<CliSelectionConfig>;
  if (raw.schemaVersion !== CLI_SCHEMA_VERSION) return null;
  const selected = normalizeSelection(raw.selected);
  if (
    selected.kind === 'auto' &&
    shouldTreatSchemaOneCliAsLegacy(value, raw.selected)
  ) {
    return null;
  }
  const customPaths = Array.isArray(raw.customPaths)
    ? raw.customPaths
        .map(normalizeCustomPath)
        .filter((item): item is CliStoredCustomPath => !!item)
    : [];
  const migrationNotice = normalizeMigrationNotice(raw.migrationNotice);
  return {
    schemaVersion: CLI_SCHEMA_VERSION,
    selected,
    customPaths,
    ...(migrationNotice ? { migrationNotice } : {}),
  };
}

function shouldTreatSchemaOneCliAsLegacy(
  value: object,
  selected: unknown,
): boolean {
  if (!hasLegacyCliFields(value)) return false;
  return !isExplicitAutoSelection(selected);
}

function hasLegacyCliFields(value: object): boolean {
  const raw = value as Record<string, unknown>;
  return (
    raw.selectedCli !== undefined ||
    raw.cliPath !== undefined ||
    raw.cliCommand !== undefined ||
    raw.commandPath !== undefined ||
    raw.path !== undefined ||
    raw.command !== undefined
  );
}

function isExplicitAutoSelection(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return (value as Record<string, unknown>).kind === 'auto';
}

function normalizeSelection(value: unknown): CliSelection {
  if (typeof value !== 'object' || value === null) {
    return { kind: 'auto' };
  }
  const raw = value as Record<string, unknown>;
  if (raw.kind === 'known' && typeof raw.command === 'string') {
    return {
      kind: 'known',
      adapter: normalizeAdapter(raw.adapter),
      command: raw.command,
      selectedAt:
        typeof raw.selectedAt === 'string'
          ? raw.selectedAt
          : new Date().toISOString(),
      pathHint: typeof raw.pathHint === 'string' ? raw.pathHint : undefined,
      platform: normalizePlatform(raw.platform),
    };
  }
  if (
    raw.kind === 'path' &&
    typeof raw.path === 'string' &&
    typeof raw.normalizedPath === 'string'
  ) {
    return {
      kind: 'path',
      adapter: normalizeAdapter(raw.adapter),
      path: raw.path,
      normalizedPath: raw.normalizedPath,
      selectedAt:
        typeof raw.selectedAt === 'string'
          ? raw.selectedAt
          : new Date().toISOString(),
      platform: normalizePlatform(raw.platform) ?? frontendPlatform(),
    };
  }
  return { kind: 'auto' };
}

function normalizeCustomPath(value: unknown): CliStoredCustomPath | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.path !== 'string' || typeof raw.normalizedPath !== 'string') {
    return null;
  }
  return {
    adapter: normalizeAdapter(raw.adapter),
    path: raw.path,
    normalizedPath: raw.normalizedPath,
    platform: normalizePlatform(raw.platform) ?? frontendPlatform(),
    addedAt:
      typeof raw.addedAt === 'string'
        ? raw.addedAt
        : new Date().toISOString(),
    lastSeenAt: typeof raw.lastSeenAt === 'string' ? raw.lastSeenAt : undefined,
    lastError:
      typeof raw.lastError === 'object' && raw.lastError !== null
        ? (raw.lastError as CliStoredCustomPath['lastError'])
      : undefined,
  };
}

function normalizeMigrationNotice(
  value: unknown,
): CliMigrationNotice | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (
    raw.code !== 'legacy-shell-wrapper' &&
    raw.code !== 'legacy-unrecognized' &&
    raw.code !== 'legacy-path-unavailable'
  ) {
    return undefined;
  }
  if (typeof raw.raw !== 'string') return undefined;
  return {
    code: raw.code,
    raw: raw.raw,
    createdAt:
      typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
  };
}

type LegacyCliSource = {
  raw: string;
  adapter?: RuntimeAdapterId;
  origin: string;
};

type LegacyCliResolution = {
  config: CliSelectionConfig;
  notice?: CliMigrationNotice;
};

function collectLegacyCliSources(
  rootConfig: Awaited<ReturnType<typeof historyStore.getConfig>>,
): LegacyCliSource[] {
  const sources: LegacyCliSource[] = [];
  const root = rootConfig as unknown as Record<string, unknown>;
  const rootAdapter = readLegacyAdapterHint(root);

  addLegacyCliSourcesFromValue(sources, root.selectedCli, 'config.selectedCli', rootAdapter);

  const legacyCli = root.cli;
  if (typeof legacyCli === 'string') {
    addLegacyCliSource(sources, legacyCli, 'config.cli');
  } else if (typeof legacyCli === 'object' && legacyCli !== null) {
    const cli = legacyCli as Record<string, unknown>;
    const cliAdapter = readLegacyAdapterHint(cli) ?? rootAdapter;
    addLegacyCliSourcesFromValue(sources, cli.selectedCli, 'config.cli.selectedCli', cliAdapter);
    addLegacyCliSourcesFromValue(sources, cli.cliCommand, 'config.cli.cliCommand', cliAdapter);
    addLegacyCliSourcesFromValue(sources, cli.cliPath, 'config.cli.cliPath', cliAdapter);
    addLegacyCliSourcesFromValue(sources, cli.commandPath, 'config.cli.commandPath', cliAdapter);
    addLegacyCliSourcesFromValue(sources, cli.path, 'config.cli.path', cliAdapter);
    addLegacyCliSourcesFromValue(sources, cli.command, 'config.cli.command', cliAdapter);
    addLegacyCliSourcesFromValue(sources, cli.selected, 'config.cli.selected', cliAdapter);
  }

  addLegacyCliSourcesFromValue(sources, root.cliCommand, 'config.cliCommand', rootAdapter);
  addLegacyCliSourcesFromValue(sources, root.cliPath, 'config.cliPath', rootAdapter);
  addLegacyCliSourcesFromValue(sources, root.commandPath, 'config.commandPath', rootAdapter);

  const storageAdapter =
    normalizeLegacyAdapter(readLocalStorage(LEGACY_CLI_ADAPTER_STORAGE)) ??
    rootAdapter;
  addLegacyCliSourcesFromValue(
    sources,
    readLocalStorage(LEGACY_CLI_PATH_STORAGE),
    'localStorage.ugs_cli_path',
    storageAdapter,
  );
  addLegacyCliSourcesFromValue(
    sources,
    readLocalStorage(LEGACY_CLI_COMMAND_STORAGE),
    'localStorage.ugs_cli_command',
    storageAdapter,
  );
  addLegacyCliSourcesFromValue(
    sources,
    readLocalStorage(LEGACY_SELECTED_CLI_STORAGE),
    'localStorage.ugs_selected_cli',
    storageAdapter,
  );

  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.adapter ?? ''}\u0000${source.raw.trim()}`;
    if (!source.raw.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addLegacyCliSourcesFromValue(
  sources: LegacyCliSource[],
  value: unknown,
  origin: string,
  adapter?: RuntimeAdapterId,
): void {
  if (typeof value === 'string') {
    addLegacyCliSource(sources, value, origin, adapter);
    return;
  }
  if (typeof value !== 'object' || value === null) return;

  const raw = value as Record<string, unknown>;
  const nestedAdapter = readLegacyAdapterHint(raw) ?? adapter;
  const selected = raw.selected;
  if (typeof selected === 'string') {
    addLegacyCliSource(sources, selected, `${origin}.selected`, nestedAdapter);
  } else if (typeof selected === 'object' && selected !== null) {
    const selectedRaw = selected as Record<string, unknown>;
    const selectedAdapter = readLegacyAdapterHint(selectedRaw) ?? nestedAdapter;
    const selectedKind = typeof selectedRaw.kind === 'string' ? selectedRaw.kind : '';
    if (selectedKind === 'path') {
      const path =
        typeof selectedRaw.path === 'string'
          ? selectedRaw.path
          : typeof selectedRaw.normalizedPath === 'string'
            ? selectedRaw.normalizedPath
            : '';
      addLegacyCliSource(sources, path, `${origin}.selected.path`, selectedAdapter);
    } else if (selectedKind === 'known') {
      const command =
        typeof selectedRaw.command === 'string'
          ? selectedRaw.command
          : typeof selectedRaw.pathHint === 'string'
            ? selectedRaw.pathHint
            : '';
      addLegacyCliSource(sources, command, `${origin}.selected.command`, selectedAdapter);
    } else {
      addLegacyCliSourcesFromValue(
        sources,
        selectedRaw.cliCommand,
        `${origin}.selected.cliCommand`,
        selectedAdapter,
      );
      addLegacyCliSourcesFromValue(
        sources,
        selectedRaw.cliPath,
        `${origin}.selected.cliPath`,
        selectedAdapter,
      );
      addLegacyCliSourcesFromValue(
        sources,
        selectedRaw.path,
        `${origin}.selected.path`,
        selectedAdapter,
      );
      addLegacyCliSourcesFromValue(
        sources,
        selectedRaw.command,
        `${origin}.selected.command`,
        selectedAdapter,
      );
      addLegacyCliSourcesFromValue(
        sources,
        selectedRaw.commandPath,
        `${origin}.selected.commandPath`,
        selectedAdapter,
      );
      addLegacyCliSourcesFromValue(
        sources,
        selectedRaw.selectedCli,
        `${origin}.selected.selectedCli`,
        selectedAdapter,
      );
    }
  }

  addLegacyCliSourcesFromValue(sources, raw.selectedCli, `${origin}.selectedCli`, nestedAdapter);
  addLegacyCliSourcesFromValue(sources, raw.cliCommand, `${origin}.cliCommand`, nestedAdapter);
  addLegacyCliSourcesFromValue(sources, raw.cliPath, `${origin}.cliPath`, nestedAdapter);
  addLegacyCliSourcesFromValue(sources, raw.commandPath, `${origin}.commandPath`, nestedAdapter);
  addLegacyCliSourcesFromValue(sources, raw.path, `${origin}.path`, nestedAdapter);
  addLegacyCliSourcesFromValue(sources, raw.command, `${origin}.command`, nestedAdapter);
}

function addLegacyCliSource(
  sources: LegacyCliSource[],
  raw: string,
  origin: string,
  adapter?: LegacyCliSource['adapter'],
): void {
  const compact = raw.trim();
  if (!compact) return;
  sources.push({ raw: compact, origin, ...(adapter ? { adapter } : {}) });
}

function readLegacyAdapterHint(
  value: unknown,
): LegacyCliSource['adapter'] | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const adapter = raw.adapter ?? raw.cliAdapter ?? raw.selectedAdapter ?? raw.runtimeAdapter;
  return normalizeLegacyAdapter(adapter);
}

function normalizeLegacyAdapter(value: unknown): LegacyCliSource['adapter'] | undefined {
  if (value === 'claude-code' || value === 'codex' || value === 'gemini') {
    return value;
  }
  if (value === 'claude') return 'claude-code';
  return undefined;
}

async function resolveLegacyCliSource(
  source: LegacyCliSource,
): Promise<LegacyCliResolution | null> {
  return resolveLegacyCliValue(source.raw, source.adapter);
}

async function resolveLegacyCliValue(
  raw: string,
  adapterHint?: RuntimeAdapterId,
): Promise<LegacyCliResolution | null> {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const selectedAt = new Date().toISOString();
  const legacyNotice = (code: CliMigrationNotice['code']): CliMigrationNotice => ({
    code,
    raw: trimmed,
    createdAt: selectedAt,
  });

  const direct = await resolveLegacyCliDirect(trimmed, adapterHint, selectedAt);
  if (direct) return direct;

  const tokens = tokenizeLegacyCliCommand(trimmed);
  if (tokens.length > 1) {
    const nested = findNestedLegacyCliToken(tokens.slice(1));
    if (nested) {
      const resolved = await resolveLegacyCliDirect(
        nested.token,
        nested.adapter ?? adapterHint,
        selectedAt,
      );
      if (resolved) return resolved;
    }
  }

  if (isLegacyShellWrapperToken(tokens[0] ?? trimmed)) {
    const notice = legacyNotice('legacy-shell-wrapper');
    return {
      config: {
        schemaVersion: CLI_SCHEMA_VERSION,
        selected: fallbackSelection(adapterHint),
        customPaths: [],
        migrationNotice: notice,
      },
      notice,
    };
  }

  const inferred = inferLegacyKnownCliFromToken(tokens[0] ?? trimmed);
  if (inferred) {
    return {
      config: {
        schemaVersion: CLI_SCHEMA_VERSION,
        selected: {
          kind: 'known',
          adapter: inferred.adapter,
          command: inferred.command,
          selectedAt,
          ...(inferred.pathHint ? { pathHint: inferred.pathHint } : {}),
        },
        customPaths: [],
      },
    };
  }

  if (adapterHint) {
    const notice = legacyNotice('legacy-unrecognized');
    return {
      config: {
        schemaVersion: CLI_SCHEMA_VERSION,
        selected: {
          kind: 'known',
          adapter: adapterHint,
          command: adapterDefaultCommand(adapterHint),
          selectedAt,
        },
        customPaths: [],
        migrationNotice: notice,
      },
      notice,
    };
  }

  const notice = legacyNotice('legacy-unrecognized');
  return {
    config: {
      schemaVersion: CLI_SCHEMA_VERSION,
      selected: { kind: 'auto' },
      customPaths: [],
      migrationNotice: notice,
    },
    notice,
  };
}

async function resolveLegacyCliDirect(
  raw: string,
  adapterHint: LegacyCliSource['adapter'],
  selectedAt: string,
): Promise<LegacyCliResolution | null> {
  if (isTauri()) {
    try {
      const validation = await validateCliPath(raw);
      const adapter = normalizeLegacyAdapter(adapterHint) ?? inferAdapterFromPath(validation.path);
      return {
        config: {
          schemaVersion: CLI_SCHEMA_VERSION,
          selected: {
            kind: 'path',
            adapter,
            path: validation.path,
            normalizedPath: validation.normalizedPath,
            selectedAt,
            platform: validation.platform,
          },
          customPaths: [
            {
              adapter,
              path: validation.path,
              normalizedPath: validation.normalizedPath,
              platform: validation.platform,
              addedAt: selectedAt,
              lastSeenAt: selectedAt,
            },
          ],
        },
      };
    } catch {
      // Path validation is best-effort during migration. Fall through to
      // command-name detection, shell unwrapping, or safe fallback below.
    }
  }

  const inferred = inferLegacyKnownCliFromToken(raw);
  if (inferred) {
    return {
      config: {
        schemaVersion: CLI_SCHEMA_VERSION,
        selected: {
          kind: 'known',
          adapter: inferred.adapter,
          command: inferred.command,
          selectedAt,
          ...(inferred.pathHint ? { pathHint: inferred.pathHint } : {}),
        },
        customPaths: [],
      },
    };
  }

  if (isShellWrapperLike(raw)) {
    const nested = findNestedLegacyCliToken(tokenizeLegacyCliCommand(raw));
    if (nested) {
      const nestedResolved = await resolveLegacyCliDirect(
        nested.token,
        nested.adapter ?? adapterHint,
        selectedAt,
      );
      if (nestedResolved) return nestedResolved;
    }
  }

  if (adapterHint && looksLikeLegacyPath(raw)) {
    const notice = legacyCliMigrationNotice('legacy-path-unavailable', raw);
    return {
      config: {
        schemaVersion: CLI_SCHEMA_VERSION,
        selected: {
          kind: 'known',
          adapter: adapterHint,
          command: adapterDefaultCommand(adapterHint),
          selectedAt,
        },
        customPaths: [],
        migrationNotice: notice,
      },
      notice,
    };
  }

  return null;
}

function fallbackSelection(
  adapterHint?: LegacyCliSource['adapter'],
): CliSelection {
  if (adapterHint) {
    return {
      kind: 'known',
      adapter: adapterHint,
      command: adapterDefaultCommand(adapterHint),
      selectedAt: new Date().toISOString(),
    };
  }
  return { kind: 'auto' };
}

function legacyCliMigrationNotice(
  code: CliMigrationNotice['code'],
  raw: string,
): CliMigrationNotice {
  return {
    code,
    raw,
    createdAt: new Date().toISOString(),
  };
}

function tokenizeLegacyCliCommand(raw: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (const ch of raw.trim()) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/u.test(ch)) {
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

function findNestedLegacyCliToken(
  tokens: string[],
): { token: string; adapter?: LegacyCliSource['adapter'] } | null {
  for (const token of tokens) {
    const adapter = inferLegacyKnownCliFromToken(token);
    if (adapter) return { token, adapter: adapter.adapter };
  }
  return null;
}

function inferLegacyKnownCliFromToken(
  token: string,
): { adapter: RuntimeAdapterId; command: string; pathHint?: string } | null {
  const compact = token.trim();
  if (!compact) return null;
  const stem = legacyCliStem(compact);
  if (stem === 'claude' || stem === 'claude-code') {
    return {
      adapter: 'claude-code',
      command: stem === 'claude-code' ? 'claude-code' : 'claude',
      ...(looksLikeLegacyPath(compact) ? { pathHint: compact } : {}),
    };
  }
  if (stem === 'codex') {
    return {
      adapter: 'codex',
      command: 'codex',
      ...(looksLikeLegacyPath(compact) ? { pathHint: compact } : {}),
    };
  }
  if (stem === 'gemini') {
    return {
      adapter: 'gemini',
      command: 'gemini',
      ...(looksLikeLegacyPath(compact) ? { pathHint: compact } : {}),
    };
  }
  return null;
}

function isShellWrapperLike(raw: string): boolean {
  return isLegacyShellWrapperToken(legacyCliStem(raw));
}

function isLegacyShellWrapperToken(token: string): boolean {
  const stem = legacyCliStem(token);
  return (
    stem === 'powershell' ||
    stem === 'pwsh' ||
    stem === 'cmd' ||
    stem === 'command' ||
    stem === 'wscript' ||
    stem === 'cscript' ||
    stem === 'sh' ||
    stem === 'bash' ||
    stem === 'zsh' ||
    stem === 'fish' ||
    stem === 'dash' ||
    stem === 'ksh' ||
    stem === 'csh' ||
    stem === 'tcsh'
  );
}

function looksLikeLegacyPath(raw: string): boolean {
  return (
    raw.includes('/') ||
    raw.includes('\\') ||
    /^[A-Za-z]:[\\/]/u.test(raw) ||
    raw.startsWith('\\\\')
  );
}

function legacyCliStem(raw: string): string {
  const compact = raw.trim().replace(/^['"&]+|['"&]+$/g, '');
  const leaf = compact.split(/[\\/]/).pop() ?? compact;
  const head = leaf.split(/\s+/u)[0] ?? leaf;
  return head.replace(/\.(exe|cmd|bat|com|ps1|sh)$/iu, '').toLowerCase();
}

async function buildCandidates(
  scanned: ModelCliCandidate[],
  config: CliSelectionConfig,
): Promise<CliCandidate[]> {
  const scanCandidates = scanned
    .map(candidateFromScan)
    .filter((candidate): candidate is CliCandidate => !!candidate);

  const customEntries = collectCustomEntries(config);
  const customCandidates = await Promise.all(
    customEntries.map((entry) => candidateFromCustomPath(entry)),
  );

  return dedupeCandidates([...scanCandidates, ...customCandidates]);
}

function candidateFromScan(candidate: ModelCliCandidate): CliCandidate | null {
  const adapter = normalizeAdapter(candidate.adapter);
  const command = candidate.command || adapterDefaultCommand(adapter);
  const path = candidate.path?.trim() || undefined;
  const status = candidate.available
    ? 'available'
    : statusFromBackend(candidate.status, candidate.error);
  return {
    id: candidateId(adapter, path ?? command, candidate.platform),
    adapter,
    command,
    path,
    normalizedPath: path,
    source: 'scan',
    status,
    hint: candidate.hint ?? path ?? command,
    error: candidate.error ?? undefined,
    platform: candidate.platform,
  };
}

async function candidateFromCustomPath(
  entry: CliStoredCustomPath,
): Promise<CliCandidate> {
  if (!isTauri()) {
    return customPathCandidate(entry, {
      status: 'missing',
      error: '当前环境不支持本地 CLI。',
    });
  }
  try {
    const validation = await validateCliPath(entry.path);
    return customPathCandidate(
      {
        ...entry,
        path: entry.path,
        normalizedPath: validation.normalizedPath,
        platform: validation.platform,
        lastSeenAt: new Date().toISOString(),
      },
      { status: 'available' },
    );
  } catch (err) {
    const raw = errorMessage(err);
    return customPathCandidate(entry, {
      status: statusFromBackend(raw, raw),
      error: raw,
    });
  }
}

function customPathCandidate(
  entry: CliStoredCustomPath,
  patch: Pick<CliCandidate, 'status'> & Partial<Pick<CliCandidate, 'error'>>,
): CliCandidate {
  return {
    id: candidateId(entry.adapter, entry.normalizedPath, entry.platform),
    adapter: entry.adapter,
    command: entry.path,
    path: entry.path,
    normalizedPath: entry.normalizedPath,
    source: 'custom',
    status: patch.status,
    hint: entry.path,
    error: patch.error,
    platform: entry.platform,
    addedAt: entry.addedAt,
    lastSeenAt: entry.lastSeenAt,
  };
}

function collectCustomEntries(
  config: CliSelectionConfig,
): CliStoredCustomPath[] {
  const entries = [...config.customPaths];
  const selected = config.selected;
  if (selected.kind === 'path') {
    entries.unshift({
      adapter: selected.adapter,
      path: selected.path,
      normalizedPath: selected.normalizedPath,
      platform: selected.platform,
      addedAt: selected.selectedAt,
      lastSeenAt: selected.selectedAt,
    });
  }
  return dedupeCustomPaths(entries).sort((a, b) =>
    (b.lastSeenAt ?? b.addedAt).localeCompare(a.lastSeenAt ?? a.addedAt),
  );
}

function dedupeCandidates(candidates: CliCandidate[]): CliCandidate[] {
  const seen = new Map<string, CliCandidate>();
  for (const candidate of candidates) {
    const key = candidateId(
      candidate.adapter,
      candidate.normalizedPath ?? candidate.path ?? candidate.command,
      candidate.platform,
    );
    const current = seen.get(key);
    if (!current || candidatePriority(candidate) > candidatePriority(current)) {
      seen.set(key, candidate);
    }
  }
  return [...seen.values()].sort(candidateSort);
}

function candidatePriority(candidate: CliCandidate): number {
  if (candidate.source === 'custom') return 3;
  if (candidate.status === 'available') return 2;
  return 1;
}

function candidateSort(a: CliCandidate, b: CliCandidate): number {
  const adapterRank =
    adapterOrder(a.adapter) - adapterOrder(b.adapter);
  if (a.source === 'scan' && b.source === 'scan') return adapterRank;
  if (a.source === 'scan') return -1;
  if (b.source === 'scan') return 1;
  const recency = (b.lastSeenAt ?? b.addedAt ?? '').localeCompare(
    a.lastSeenAt ?? a.addedAt ?? '',
  );
  return recency || adapterRank;
}

function adapterOrder(adapter: RuntimeAdapterId): number {
  return RUNTIME_ADAPTERS.findIndex((item) => item.id === adapter);
}

function upsertCustomPath(
  current: CliStoredCustomPath[],
  next: CliStoredCustomPath,
): CliStoredCustomPath[] {
  return dedupeCustomPaths([next, ...current]);
}

function dedupeCustomPaths(
  paths: CliStoredCustomPath[],
): CliStoredCustomPath[] {
  const seen = new Map<string, CliStoredCustomPath>();
  for (const path of paths) {
    const key = candidateId(path.adapter, path.normalizedPath, path.platform);
    const current = seen.get(key);
    if (!current) {
      seen.set(key, path);
      continue;
    }
    seen.set(key, {
      ...current,
      ...path,
      addedAt: current.addedAt || path.addedAt,
      lastSeenAt: path.lastSeenAt ?? current.lastSeenAt,
    });
  }
  return [...seen.values()];
}

function findPathCandidate(
  runtime: CliRuntimeSnapshot,
  adapter: RuntimeAdapterId,
  normalizedPath: string,
): CliCandidate | undefined {
  return runtime.candidates.find(
    (candidate) =>
      candidate.adapter === adapter &&
      candidateId(
        candidate.adapter,
        candidate.normalizedPath ?? candidate.path ?? candidate.command,
        candidate.platform,
      ) === candidateId(adapter, normalizedPath, candidate.platform),
  );
}

function latestAvailableCustomCandidate(
  runtime: CliRuntimeSnapshot,
  adapter: RuntimeAdapterId,
): CliCandidate | undefined {
  return runtime.candidates.find(
    (candidate) =>
      candidate.adapter === adapter &&
      candidate.source === 'custom' &&
      candidate.status === 'available',
  );
}

function firstAvailableScanCandidate(
  runtime: CliRuntimeSnapshot,
  adapter: RuntimeAdapterId,
): CliCandidate | undefined {
  return runtime.candidates.find(
    (candidate) =>
      candidate.adapter === adapter &&
      candidate.source === 'scan' &&
      candidate.status === 'available',
  );
}

function statusFromBackend(
  status: string | undefined,
  error?: string | null,
): CliCandidateStatus {
  const raw = `${status ?? ''} ${error ?? ''}`.toUpperCase();
  if (raw.includes('PERMISSION_DENIED')) return 'permission-denied';
  if (raw.includes('NOT_EXECUTABLE')) return 'not-executable';
  if (raw.includes('UNSUPPORTED_CLI_TYPE')) return 'unsupported';
  if (raw.includes('NOT_FILE')) return 'invalid';
  if (status === 'available') return 'available';
  return 'missing';
}

function normalizeAdapter(value: unknown): RuntimeAdapterId {
  if (value === 'codex' || value === 'gemini' || value === 'claude-code') {
    return value;
  }
  if (value === 'claude') return 'claude-code';
  return 'claude-code';
}

function inferAdapterFromPath(path: string): RuntimeAdapterId {
  const lower = path.toLowerCase();
  if (lower.includes('codex')) return 'codex';
  if (lower.includes('gemini')) return 'gemini';
  return 'claude-code';
}

function normalizePlatform(value: unknown): CliPlatform | undefined {
  if (value === 'windows' || value === 'macos' || value === 'linux') {
    return value;
  }
  return undefined;
}

function frontendPlatform(): CliPlatform {
  const platform =
    typeof navigator === 'undefined' ? '' : navigator.platform.toLowerCase();
  if (platform.includes('win')) return 'windows';
  if (platform.includes('mac')) return 'macos';
  return 'linux';
}

function candidateId(
  adapter: RuntimeAdapterId,
  value: string,
  platform?: CliPlatform,
): string {
  const compact = value.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  const key = platform === 'windows' ? compact.toLowerCase() : compact;
  return `${adapter}:${key}`;
}

function defaultCliConfig(): CliSelectionConfig {
  return {
    schemaVersion: CLI_SCHEMA_VERSION,
    selected: { kind: 'auto' },
    customPaths: [],
  };
}

function emit(): void {
  for (const listener of listeners) listener(snapshot);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

function readLocalStorage(key: string): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
