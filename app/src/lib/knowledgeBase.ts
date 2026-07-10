import { readSettingsRaw, writeSettingsRaw } from '@/lib/generationSettingsStore';
import {
  scanKnowledgeBaseFiles,
  tauriAvailable,
  type KnowledgeBaseScanResult,
  type KnowledgeBaseScannedFile,
} from '@/lib/tauri';

const CONFIG_REL_PATH = 'settings/knowledgeBase.v1.json';
const CONFIG_LEGACY_KEY = 'ultragamestudio.knowledgeBase.v1';
const INDEX_REL_PATH = 'settings/knowledgeBaseIndex.v1.json';
const INDEX_LEGACY_KEY = 'ultragamestudio.knowledgeBaseIndex.v1';

const INDEX_VERSION = 1;
const VECTOR_DIM = 128;
const CHUNK_TARGET_CHARS = 1400;
const CHUNK_OVERLAP_CHARS = 180;
const DEFAULT_TOP_K = 6;
const DEFAULT_MAX_CONTEXT_CHARS = 9000;
const MIN_SCORE = 0.025;

export type KnowledgeBaseSourceKind = 'file' | 'folder';

export interface KnowledgeBaseSource {
  id: string;
  path: string;
  kind: KnowledgeBaseSourceKind;
  enabled: boolean;
}

export interface KnowledgeBaseIndexStats {
  fileCount: number;
  chunkCount: number;
  skippedFiles: number;
  skippedDirs: number;
  totalBytes: number;
  truncated: boolean;
}

export interface KnowledgeBaseWorkspaceConfig {
  enabled: boolean;
  topK: number;
  maxContextChars: number;
  sources: KnowledgeBaseSource[];
  lastIndexedAtMs?: number | null;
  lastIndexStats?: KnowledgeBaseIndexStats | null;
  lastIndexError?: string | null;
}

export interface KnowledgeBaseChunk {
  id: string;
  path: string;
  title: string;
  text: string;
  vector: number[];
}

export interface KnowledgeBaseWorkspaceIndex {
  version: number;
  workspaceKey: string;
  builtAtMs: number;
  sourceSignature: string;
  chunks: KnowledgeBaseChunk[];
  stats: KnowledgeBaseIndexStats;
}

export interface KnowledgeBaseSearchHit {
  chunk: KnowledgeBaseChunk;
  score: number;
}

interface KnowledgeBaseConfigStore {
  workspaces: Record<string, KnowledgeBaseWorkspaceConfig>;
}

interface KnowledgeBaseIndexStore {
  workspaces: Record<string, KnowledgeBaseWorkspaceIndex>;
}

export const DEFAULT_KNOWLEDGE_BASE_CONFIG: KnowledgeBaseWorkspaceConfig = {
  enabled: true,
  topK: DEFAULT_TOP_K,
  maxContextChars: DEFAULT_MAX_CONTEXT_CHARS,
  sources: [],
  lastIndexedAtMs: null,
  lastIndexStats: null,
  lastIndexError: null,
};

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

async function getInvoke() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
}

async function readIndexRaw(): Promise<string | null> {
  if (tauriAvailable()) {
    try {
      const invoke = await getInvoke();
      return await invoke<string | null>('history_read_json', {
        relPath: INDEX_REL_PATH,
      });
    } catch {
      return null;
    }
  }
  if (!hasLocalStorage()) return null;
  return window.localStorage.getItem(INDEX_LEGACY_KEY);
}

async function writeIndexRaw(json: string): Promise<void> {
  if (hasLocalStorage()) {
    try {
      window.localStorage.setItem(INDEX_LEGACY_KEY, json);
    } catch {
      // Desktop disk remains the source of truth; browser quota failures are non-fatal.
    }
  }
  if (!tauriAvailable()) return;
  const invoke = await getInvoke();
  await invoke<void>('history_write_json', {
    relPath: INDEX_REL_PATH,
    json,
  });
}

function coerceSource(raw: unknown): KnowledgeBaseSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<KnowledgeBaseSource>;
  const path = typeof item.path === 'string' ? item.path.trim() : '';
  if (!path) return null;
  const kind = item.kind === 'file' ? 'file' : 'folder';
  return {
    id:
      typeof item.id === 'string' && item.id.trim()
        ? item.id.trim()
        : createKnowledgeBaseSourceId(),
    path,
    kind,
    enabled: item.enabled !== false,
  };
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function coerceStats(raw: unknown): KnowledgeBaseIndexStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<KnowledgeBaseIndexStats>;
  return {
    fileCount: clampInt(item.fileCount, 0, 0, 100000),
    chunkCount: clampInt(item.chunkCount, 0, 0, 100000),
    skippedFiles: clampInt(item.skippedFiles, 0, 0, 100000),
    skippedDirs: clampInt(item.skippedDirs, 0, 0, 100000),
    totalBytes: clampInt(item.totalBytes, 0, 0, 1024 * 1024 * 1024),
    truncated: item.truncated === true,
  };
}

function coerceConfig(raw: unknown): KnowledgeBaseWorkspaceConfig {
  const d = DEFAULT_KNOWLEDGE_BASE_CONFIG;
  if (!raw || typeof raw !== 'object') return { ...d, sources: [] };
  const item = raw as Partial<KnowledgeBaseWorkspaceConfig>;
  const sources = Array.isArray(item.sources)
    ? item.sources.map(coerceSource).filter((source): source is KnowledgeBaseSource => !!source)
    : [];
  return {
    enabled: item.enabled !== false,
    topK: clampInt(item.topK, d.topK, 1, 12),
    maxContextChars: clampInt(item.maxContextChars, d.maxContextChars, 2000, 24000),
    sources,
    lastIndexedAtMs:
      typeof item.lastIndexedAtMs === 'number' && Number.isFinite(item.lastIndexedAtMs)
        ? item.lastIndexedAtMs
        : null,
    lastIndexStats: coerceStats(item.lastIndexStats),
    lastIndexError:
      typeof item.lastIndexError === 'string' && item.lastIndexError.trim()
        ? item.lastIndexError.trim()
        : null,
  };
}

function readConfigStore(): KnowledgeBaseConfigStore {
  try {
    const raw = readSettingsRaw(CONFIG_REL_PATH, CONFIG_LEGACY_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<KnowledgeBaseConfigStore>) : null;
    const workspaces =
      parsed?.workspaces && typeof parsed.workspaces === 'object'
        ? parsed.workspaces
        : {};
    return {
      workspaces: Object.fromEntries(
        Object.entries(workspaces).map(([key, value]) => [key, coerceConfig(value)]),
      ),
    };
  } catch {
    return { workspaces: {} };
  }
}

function writeConfigStore(store: KnowledgeBaseConfigStore): void {
  writeSettingsRaw(CONFIG_REL_PATH, CONFIG_LEGACY_KEY, JSON.stringify(store));
}

async function readIndexStore(): Promise<KnowledgeBaseIndexStore> {
  try {
    const raw = await readIndexRaw();
    const parsed = raw ? (JSON.parse(raw) as Partial<KnowledgeBaseIndexStore>) : null;
    const workspaces =
      parsed?.workspaces && typeof parsed.workspaces === 'object'
        ? parsed.workspaces
        : {};
    return { workspaces: workspaces as Record<string, KnowledgeBaseWorkspaceIndex> };
  } catch {
    return { workspaces: {} };
  }
}

async function writeIndexStore(store: KnowledgeBaseIndexStore): Promise<void> {
  await writeIndexRaw(JSON.stringify(store));
}

export function createKnowledgeBaseSourceId(): string {
  return `kb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function knowledgeBaseWorkspaceKey(input: {
  workspaceId?: string | null;
  workspacePath?: string | null;
}): string {
  const path = input.workspacePath?.trim();
  if (path) return `path:${path.replace(/\\/g, '/').toLowerCase()}`;
  const id = input.workspaceId?.trim();
  return id ? `id:${id}` : 'global';
}

export function loadKnowledgeBaseConfig(workspaceKey: string): KnowledgeBaseWorkspaceConfig {
  const store = readConfigStore();
  return coerceConfig(store.workspaces[workspaceKey]);
}

export function saveKnowledgeBaseConfig(
  workspaceKey: string,
  config: KnowledgeBaseWorkspaceConfig,
): KnowledgeBaseWorkspaceConfig {
  const store = readConfigStore();
  const next = coerceConfig(config);
  store.workspaces[workspaceKey] = next;
  writeConfigStore(store);
  return next;
}

export function knowledgeBaseSourceSignature(config: KnowledgeBaseWorkspaceConfig): string {
  const sources = config.sources
    .filter((source) => source.enabled && source.path.trim())
    .map((source) => ({
      kind: source.kind,
      path: source.path.trim().replace(/\\/g, '/').toLowerCase(),
    }))
    .sort((a, b) => `${a.kind}:${a.path}`.localeCompare(`${b.kind}:${b.path}`));
  return JSON.stringify({ v: INDEX_VERSION, sources });
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

function chunkText(file: KnowledgeBaseScannedFile): Array<Omit<KnowledgeBaseChunk, 'vector'>> {
  const text = normalizeText(file.text);
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const rawChunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs.length ? paragraphs : [text]) {
    if (!current) {
      current = paragraph;
      continue;
    }
    if (current.length + paragraph.length + 2 <= CHUNK_TARGET_CHARS) {
      current += `\n\n${paragraph}`;
      continue;
    }
    rawChunks.push(current);
    const overlap = current.slice(Math.max(0, current.length - CHUNK_OVERLAP_CHARS));
    current =
      overlap && paragraph.length + overlap.length + 2 <= CHUNK_TARGET_CHARS
        ? `${overlap}\n\n${paragraph}`
        : paragraph;
  }
  if (current) rawChunks.push(current);

  const chunks: Array<Omit<KnowledgeBaseChunk, 'vector'>> = [];
  for (const [index, raw] of rawChunks.entries()) {
    const body = raw.trim();
    if (!body) continue;
    chunks.push({
      id: `${stableHash(`${file.path}:${index}`)}`,
      path: file.path,
      title: basename(file.path),
      text: body,
    });
  }
  return chunks;
}

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const normalized = text.toLowerCase();
  for (const match of normalized.matchAll(/[\p{Script=Han}]+|[a-z0-9_][a-z0-9_./#-]*/gu)) {
    const raw = match[0];
    if (/^[\p{Script=Han}]+$/u.test(raw)) {
      if (raw.length === 1) {
        tokens.push(raw);
      } else {
        for (let i = 0; i < raw.length - 1; i += 1) {
          tokens.push(raw.slice(i, i + 2));
        }
      }
      continue;
    }
    const parts = raw.split(/[^a-z0-9_]+/).filter((part) => part.length >= 2);
    tokens.push(...parts);
  }
  return tokens;
}

function vectorize(text: string): number[] {
  const vector = Array.from({ length: VECTOR_DIM }, () => 0);
  for (const token of tokenize(text)) {
    const hash = stableHash(token);
    const index = hash % VECTOR_DIM;
    const sign = hash & 1 ? 1 : -1;
    vector[index] += sign;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm <= 0) return vector;
  return vector.map((value) => Number((value / norm).toFixed(4)));
}

function dot(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let out = 0;
  for (let i = 0; i < len; i += 1) out += a[i] * b[i];
  return out;
}

function statsFromScan(scan: KnowledgeBaseScanResult, chunkCount: number): KnowledgeBaseIndexStats {
  return {
    fileCount: scan.files.length,
    chunkCount,
    skippedFiles: scan.skippedFiles,
    skippedDirs: scan.skippedDirs,
    totalBytes: scan.totalBytes,
    truncated: scan.truncated,
  };
}

export async function readKnowledgeBaseIndex(
  workspaceKey: string,
): Promise<KnowledgeBaseWorkspaceIndex | null> {
  const store = await readIndexStore();
  const index = store.workspaces[workspaceKey];
  if (!index || index.version !== INDEX_VERSION || !Array.isArray(index.chunks)) return null;
  return index;
}

export async function rebuildKnowledgeBaseIndex(
  workspaceKey: string,
  config: KnowledgeBaseWorkspaceConfig,
): Promise<{
  config: KnowledgeBaseWorkspaceConfig;
  index: KnowledgeBaseWorkspaceIndex;
  scan: KnowledgeBaseScanResult;
}> {
  const activeSources = config.sources.filter((source) => source.enabled && source.path.trim());
  const scan = await scanKnowledgeBaseFiles(
    activeSources.map((source) => ({
      path: source.path,
      kind: source.kind,
      enabled: source.enabled,
    })),
  );
  const chunks = scan.files
    .flatMap(chunkText)
    .map((chunk) => ({
      ...chunk,
      vector: vectorize(`${chunk.title}\n${chunk.text}`),
    }));
  const stats = statsFromScan(scan, chunks.length);
  const builtAtMs = Date.now();
  const index: KnowledgeBaseWorkspaceIndex = {
    version: INDEX_VERSION,
    workspaceKey,
    builtAtMs,
    sourceSignature: knowledgeBaseSourceSignature(config),
    chunks,
    stats,
  };
  const indexStore = await readIndexStore();
  indexStore.workspaces[workspaceKey] = index;
  await writeIndexStore(indexStore);
  const nextConfig = saveKnowledgeBaseConfig(workspaceKey, {
    ...config,
    lastIndexedAtMs: builtAtMs,
    lastIndexStats: stats,
    lastIndexError: scan.errors.slice(0, 5).join('\n') || null,
  });
  return { config: nextConfig, index, scan };
}

async function ensureKnowledgeBaseIndex(
  workspaceKey: string,
  config: KnowledgeBaseWorkspaceConfig,
): Promise<KnowledgeBaseWorkspaceIndex | null> {
  if (!config.enabled) return null;
  if (!config.sources.some((source) => source.enabled && source.path.trim())) return null;
  let index = await readKnowledgeBaseIndex(workspaceKey);
  if (index?.sourceSignature === knowledgeBaseSourceSignature(config)) return index;
  try {
    index = (await rebuildKnowledgeBaseIndex(workspaceKey, config)).index;
    return index;
  } catch {
    return index;
  }
}

export function searchKnowledgeBaseIndex(
  index: KnowledgeBaseWorkspaceIndex,
  query: string,
  options: { limit?: number; minScore?: number } = {},
): KnowledgeBaseSearchHit[] {
  const queryVector = vectorize(query);
  const limit = Math.max(1, Math.min(12, options.limit ?? DEFAULT_TOP_K));
  const minScore = options.minScore ?? MIN_SCORE;
  return index.chunks
    .map((chunk) => ({ chunk, score: dot(queryVector, chunk.vector) }))
    .filter((hit) => hit.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function clipContextText(text: string, remaining: number): string {
  if (text.length <= remaining) return text;
  return `${text.slice(0, Math.max(0, remaining - 20)).trimEnd()}\n...（已截断）`;
}

export function renderKnowledgeBaseContext(
  hits: KnowledgeBaseSearchHit[],
  maxChars: number,
): string {
  if (!hits.length) return '';
  let remaining = Math.max(1000, maxChars);
  const parts: string[] = [
    '【本地项目知识库】',
    '以下内容来自用户在设置中配置的本地文件/文件夹。回答项目专属问题时优先使用这些资料；不要把它当成网络资料。若资料不足，明确说明缺口。',
  ];
  remaining -= parts.join('\n').length;

  for (const [index, hit] of hits.entries()) {
    if (remaining <= 0) break;
    const header = `\n[${index + 1}] ${hit.chunk.path}`;
    const body = clipContextText(hit.chunk.text, remaining - header.length);
    parts.push(`${header}\n${body}`);
    remaining -= header.length + body.length;
  }
  return `${parts.join('\n')}\n【本地项目知识库结束】`;
}

export async function renderKnowledgeBaseContextForPrompt(input: {
  workspaceId?: string | null;
  workspacePath?: string | null;
  query: string;
}): Promise<string> {
  if (input.workspacePath?.trim().startsWith('remote://')) return '';
  const workspaceKey = knowledgeBaseWorkspaceKey(input);
  const config = loadKnowledgeBaseConfig(workspaceKey);
  const index = await ensureKnowledgeBaseIndex(workspaceKey, config);
  if (!index) return '';
  const hits = searchKnowledgeBaseIndex(index, input.query, {
    limit: config.topK,
  });
  return renderKnowledgeBaseContext(hits, config.maxContextChars);
}
