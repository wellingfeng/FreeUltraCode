// ComfyUI native API client + graph model.
//
// CONTRACT: This module owns the *data + transport* layer for the embedded
// ComfyUI node-graph feature. It speaks ComfyUI's native HTTP/WS protocol
// (POST /prompt, GET /history, GET /view, GET /object_info, WS /ws) against a
// local server (default http://127.0.0.1:8188). The chat-stream rendering
// (ComfyGraphBlock) and the React Flow projection (core/comfyToFlow.ts) are
// pure transforms over the {@link ComfyPromptGraph} shape defined here.
//
// A ComfyUI "prompt graph" is a flat map of node-id -> node. Each node carries
// a `class_type` (the registered node name, e.g. "KSampler") and an `inputs`
// map whose values are either literals or `[fromNodeId, outputIndex]` links.
// This is exactly what POST /prompt accepts, so the block body is stored
// verbatim and submitted without translation.

import {
  imageProviderBaseUrl,
  loadImageGenerationSettings,
  type ImageGenerationSettings,
} from './imageGeneration';
import {
  readSettingsRaw,
  type SettingsProfileOptions,
  writeSettingsRaw,
} from '@/lib/generationSettingsStore';

export interface ComfyNodeInputs {
  [key: string]: ComfyInputValue;
}

/** A node input is either a literal, or a link `[sourceNodeId, outputIndex]`. */
export type ComfyInputValue =
  | string
  | number
  | boolean
  | null
  | [string, number];

export interface ComfyNode {
  class_type: string;
  inputs: ComfyNodeInputs;
  /** Optional UI hints ComfyUI persists in exported workflows. */
  _meta?: { title?: string };
}

/** The canonical prompt-graph shape accepted by POST /prompt. */
export interface ComfyPromptGraph {
  [nodeId: string]: ComfyNode;
}

export interface ComfyOutputImage {
  filename: string;
  subfolder: string;
  type: string;
  /** Output kind so non-image outputs (video/audio) render correctly. */
  kind: 'image' | 'video' | 'audio';
  /** Resolved /view URL for direct <img src>. */
  url: string;
}

export interface ComfyRunProgress {
  /** Currently executing node id, or null between nodes. */
  node: string | null;
  /** 0..1 sampler step progress for the active node, when reported. */
  value: number;
  max: number;
  /** Terminal images, populated once the run finishes. */
  images: ComfyOutputImage[];
  status: 'pending' | 'running' | 'done' | 'error';
  error?: string;
  /** Live preview frame (data URL) emitted by ComfyUI during sampling, if any. */
  preview?: string;
}

/**
 * Structured rejection from POST /prompt. ComfyUI returns
 * `{ error: {...}, node_errors: { <nodeId>: { errors: [...] } } }` on a 400 so
 * the caller can surface which node/field failed instead of a raw JSON blob.
 */
export class ComfyValidationError extends Error {
  readonly nodeErrors: Record<string, ComfyNodeError>;
  constructor(message: string, nodeErrors: Record<string, ComfyNodeError>) {
    super(message);
    this.name = 'ComfyValidationError';
    this.nodeErrors = nodeErrors;
  }
}

export interface ComfyNodeError {
  class_type?: string;
  errors?: Array<{
    type?: string;
    message?: string;
    details?: string;
    extra_info?: Record<string, unknown>;
  }>;
}

const STORAGE_KEY = 'ultragamestudio.comfyui.v1';
const SETTINGS_REL_PATH = 'settings/comfyui.v1.json';
const DEFAULT_BASE_URL = 'http://127.0.0.1:8188';

export interface ComfyUiSettings {
  baseUrl: string;
}

export const DEFAULT_COMFYUI_SETTINGS: ComfyUiSettings = {
  baseUrl: DEFAULT_BASE_URL,
};

export function loadComfyUiSettings(
  options: SettingsProfileOptions = {},
): ComfyUiSettings {
  try {
    const raw = readSettingsRaw(SETTINGS_REL_PATH, STORAGE_KEY, options);
    if (!raw) return DEFAULT_COMFYUI_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ComfyUiSettings>;
    const baseUrl =
      typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim()
        ? parsed.baseUrl.trim().replace(/\/+$/, '')
        : DEFAULT_BASE_URL;
    return { baseUrl };
  } catch {
    return DEFAULT_COMFYUI_SETTINGS;
  }
}

export function saveComfyUiSettings(
  settings: ComfyUiSettings,
  options: SettingsProfileOptions = {},
): void {
  const payload = JSON.stringify({
    baseUrl: settings.baseUrl.trim().replace(/\/+$/, ''),
  });
  const ok = writeSettingsRaw(SETTINGS_REL_PATH, STORAGE_KEY, payload, options);
  if (!ok) {
    console.error('[comfyui] failed to persist settings');
    return;
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('ugs:comfyui-settings-changed'));
  }
}

export function comfyBaseUrl(
  settings = loadComfyUiSettings(),
  imageSettings: ImageGenerationSettings = loadImageGenerationSettings(),
): string {
  // Prefer the shared image-generation "ComfyUI" channel so a single place
  // configures both simple image generation and the embedded node-graph
  // runner. A value explicitly saved in the standalone ComfyUI settings (one
  // that differs from the built-in localhost default) still wins as an override.
  const own = (settings.baseUrl || '').replace(/\/+$/, '');
  if (own && own !== DEFAULT_BASE_URL) return own;
  const channel = imageProviderBaseUrl('local-comfyui', imageSettings).replace(/\/+$/, '');
  return channel || own || DEFAULT_BASE_URL;
}

/**
 * API key/token for the configured ComfyUI endpoint, sourced from the shared
 * image-generation `local-comfyui` channel. Empty for the typical unauthenticated
 * local server; populated when pointing at an authenticated remote/cloud ComfyUI.
 */
export function comfyApiKey(
  imageSettings: ImageGenerationSettings = loadImageGenerationSettings(),
): string {
  return imageSettings.providerKeys['local-comfyui']?.trim() ?? '';
}

/** Authorization headers for the ComfyUI endpoint (empty when no key is set). */
export function comfyAuthHeaders(apiKey = comfyApiKey()): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function newClientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `comfy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Build a /view URL for an output image record. */
export function comfyViewUrl(
  baseUrl: string,
  image: { filename: string; subfolder?: string; type?: string },
): string {
  const params = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder ?? '',
    type: image.type ?? 'output',
  });
  return `${baseUrl}/view?${params.toString()}`;
}

/**
 * Parse a fenced ` ```comfyui ` block body into a prompt graph. The body may be
 * either the bare prompt-map ({id: {class_type, inputs}}) or a wrapper object
 * carrying it under `prompt` / `workflow`. Returns null on invalid JSON so the
 * renderer can fall back to a raw code view instead of throwing.
 */
export function parseComfyGraph(raw: string): ComfyPromptGraph | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const candidate = isPromptGraph(obj.prompt)
    ? (obj.prompt as ComfyPromptGraph)
    : isPromptGraph(obj.workflow)
      ? (obj.workflow as ComfyPromptGraph)
      : isPromptGraph(obj)
        ? (obj as ComfyPromptGraph)
        : null;
  return candidate;
}

function isPromptGraph(value: unknown): value is ComfyPromptGraph {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.values(value as Record<string, unknown>);
  if (entries.length === 0) return false;
  return entries.every(
    (node) =>
      !!node &&
      typeof node === 'object' &&
      !Array.isArray(node) &&
      typeof (node as ComfyNode).class_type === 'string',
  );
}

/** Serialize a graph back into a stable, pretty block body for write-back. */
export function stringifyComfyGraph(graph: ComfyPromptGraph): string {
  return JSON.stringify(graph, null, 2);
}

/**
 * Randomize the seed on any KSampler-like node so re-running yields a new image
 * (ComfyUI's front-end does this via `control_after_generate`; the prompt JSON
 * we submit carries a fixed value otherwise). Returns a new graph; the input is
 * left untouched. Looks for a numeric `seed` or `noise_seed` input.
 */
export function randomizeSeeds(graph: ComfyPromptGraph): ComfyPromptGraph {
  const next = structuredClone(graph);
  for (const node of Object.values(next)) {
    for (const key of ['seed', 'noise_seed']) {
      if (typeof node.inputs?.[key] === 'number') {
        // ComfyUI seeds are unsigned 64-bit; JS-safe range is plenty for entropy.
        node.inputs[key] = Math.floor(Math.random() * 0xffffffffff);
      }
    }
  }
  return next;
}

/**
 * Strip a leading ComfyUI slash command / mode marker from a user message,
 * leaving the bare image/workflow description. Mirrors stripImageCommand.
 */
export function stripComfyCommand(text: string): string {
  return text
    .trim()
    .replace(/^\/(?:comfyui|comfy)(?:-mode-(?:start|end))?\s*/iu, '')
    .trim();
}

// ── Transport ──────────────────────────────────────────────────────────────

interface ComfyOutputAsset {
  filename: string;
  subfolder: string;
  type: string;
}

interface ComfyHistoryEntry {
  outputs?: Record<
    string,
    {
      images?: ComfyOutputAsset[];
      gifs?: ComfyOutputAsset[];
      audio?: ComfyOutputAsset[];
    }
  >;
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: Array<[string, Record<string, unknown>]>;
  };
}

/** Brief node-type summary from /object_info, used to constrain AI authoring. */
export interface ComfyObjectInfoSummary {
  /** Registered class_type names available on the server. */
  classTypes: string[];
  /** Full per-node input schema, keyed by class_type (for editor + validation). */
  schemas: Record<string, ComfyNodeSchema>;
}

/** Input schema for a single node class, distilled from /object_info. */
export interface ComfyNodeSchema {
  classType: string;
  displayName: string;
  /** Required input name -> spec. */
  required: Record<string, ComfyInputSpec>;
  optional: Record<string, ComfyInputSpec>;
  /** Output type labels in order. */
  outputs: string[];
}

export interface ComfyInputSpec {
  /** Primitive type ("INT", "FLOAT", "STRING", "BOOLEAN") or "LINK" for node inputs. */
  type: string;
  /** Enumerated choices when the input is a combo (dropdown). */
  options?: Array<string | number>;
  default?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
}

/**
 * Distill ComfyUI's verbose /object_info entry into a compact input schema.
 * ComfyUI encodes each input as either `[<TYPE>, {opts}]` (primitive/combo) or
 * `[[...choices], {opts}]` (a literal list of choices). Link-typed inputs use an
 * uppercase type name that isn't a known primitive.
 */
function parseNodeSchema(classType: string, raw: unknown): ComfyNodeSchema | null {
  if (!raw || typeof raw !== 'object') return null;
  const node = raw as Record<string, unknown>;
  const inputDef = (node.input ?? {}) as Record<string, unknown>;
  const parseGroup = (group: unknown): Record<string, ComfyInputSpec> => {
    const out: Record<string, ComfyInputSpec> = {};
    if (!group || typeof group !== 'object') return out;
    for (const [name, def] of Object.entries(group as Record<string, unknown>)) {
      const spec = parseInputSpec(def);
      if (spec) out[name] = spec;
    }
    return out;
  };
  const outputs = Array.isArray(node.output)
    ? (node.output as unknown[]).map((o) => String(o))
    : [];
  return {
    classType,
    displayName:
      typeof node.display_name === 'string' && node.display_name
        ? node.display_name
        : classType,
    required: parseGroup(inputDef.required),
    optional: parseGroup(inputDef.optional),
    outputs,
  };
}

const PRIMITIVE_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'NUMBER']);

function parseInputSpec(def: unknown): ComfyInputSpec | null {
  if (!Array.isArray(def) || def.length === 0) return null;
  const [typeOrChoices, opts] = def as [unknown, Record<string, unknown> | undefined];
  const options = opts && typeof opts === 'object' ? opts : {};
  if (Array.isArray(typeOrChoices)) {
    return {
      type: 'COMBO',
      options: typeOrChoices.filter(
        (c): c is string | number => typeof c === 'string' || typeof c === 'number',
      ),
      default: options.default as string | number | undefined,
    };
  }
  const typeName = String(typeOrChoices);
  const spec: ComfyInputSpec = {
    type: PRIMITIVE_TYPES.has(typeName) ? typeName : 'LINK',
  };
  if (typeof options.default === 'string' || typeof options.default === 'number' || typeof options.default === 'boolean') {
    spec.default = options.default;
  }
  if (typeof options.min === 'number') spec.min = options.min;
  if (typeof options.max === 'number') spec.max = options.max;
  if (typeof options.step === 'number') spec.step = options.step;
  return spec;
}

/**
 * Fetch the available node definitions so the authoring model can be told which
 * `class_type`s actually exist (otherwise it invents non-existent nodes), and
 * so the editor can validate before submit. Returns both the class-type names
 * and the distilled per-node input schemas.
 */
export async function fetchComfyObjectInfo(
  baseUrl = comfyBaseUrl(),
  signal?: AbortSignal,
): Promise<ComfyObjectInfoSummary> {
  const response = await fetch(`${baseUrl}/object_info`, {
    headers: comfyAuthHeaders(),
    signal,
  });
  if (!response.ok) {
    throw new Error(`ComfyUI /object_info ${response.status} ${response.statusText}`);
  }
  const json = (await response.json()) as Record<string, unknown>;
  const schemas: Record<string, ComfyNodeSchema> = {};
  for (const [classType, raw] of Object.entries(json)) {
    const schema = parseNodeSchema(classType, raw);
    if (schema) schemas[classType] = schema;
  }
  return { classTypes: Object.keys(json), schemas };
}

/**
 * Validate a prompt graph against the server schema before submit so obvious
 * problems (unknown node types, missing required inputs, dangling links) are
 * caught locally with a readable message instead of a generic 400. Returns a
 * list of human-readable problems; empty means the graph passed local checks.
 */
export function validateComfyGraph(
  graph: ComfyPromptGraph,
  info: ComfyObjectInfoSummary,
): string[] {
  const problems: string[] = [];
  const known = new Set(info.classTypes);
  for (const [id, node] of Object.entries(graph)) {
    const title = node._meta?.title?.trim() || node.class_type;
    if (!known.has(node.class_type)) {
      problems.push(`节点 ${id}（${title}）：服务器上不存在节点类型 "${node.class_type}"`);
      continue;
    }
    const schema = info.schemas[node.class_type];
    if (!schema) continue;
    for (const name of Object.keys(schema.required)) {
      if (!(name in (node.inputs ?? {}))) {
        problems.push(`节点 ${id}（${title}）：缺少必填输入 "${name}"`);
      }
    }
    for (const value of Object.values(node.inputs ?? {})) {
      if (Array.isArray(value) && typeof value[0] === 'string' && !graph[value[0]]) {
        problems.push(`节点 ${id}（${title}）：连线指向不存在的源节点 "${value[0]}"`);
      }
    }
  }
  return problems;
}

/**
 * Submit a prompt graph to ComfyUI and resolve once an output image is ready.
 * Uses POST /prompt to enqueue, then polls GET /history/{id} until the run
 * completes (a WS subscription would give finer progress; polling keeps the
 * first cut dependency-free and robust to reconnects). `onProgress` is invoked
 * with coarse status transitions.
 */
export async function runComfyGraph(
  graph: ComfyPromptGraph,
  options: {
    baseUrl?: string;
    apiKey?: string;
    signal?: AbortSignal;
    onProgress?: (progress: ComfyRunProgress) => void;
  } = {},
): Promise<ComfyOutputImage[]> {
  const baseUrl = options.baseUrl ?? comfyBaseUrl();
  const clientId = newClientId();
  const authHeaders = comfyAuthHeaders(options.apiKey);
  const { signal, onProgress } = options;
  const emit = (p: Partial<ComfyRunProgress>) =>
    onProgress?.({
      node: null,
      value: 0,
      max: 0,
      images: [],
      status: 'running',
      ...p,
    });

  emit({ status: 'pending' });
  const startResponse = await fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ prompt: graph, client_id: clientId }),
    signal,
  });
  if (!startResponse.ok) {
    const detail = await readPromptError(startResponse);
    emit({ status: 'error', error: detail.message });
    throw detail.error;
  }
  const started = (await startResponse.json()) as { prompt_id?: string };
  const promptId = started.prompt_id;
  if (!promptId) throw new Error('ComfyUI did not return a prompt_id.');

  emit({ status: 'running' });

  // Prefer a WS subscription for fine-grained progress/preview, falling back to
  // /history polling for the terminal result (and when WS is unavailable).
  const ws = openProgressSocket(baseUrl, clientId, promptId, emit, signal);
  try {
    return await pollHistory(baseUrl, promptId, authHeaders, emit, signal);
  } finally {
    ws?.close();
  }
}

/**
 * Parse a non-OK POST /prompt response into a readable error. ComfyUI returns a
 * structured `{ error, node_errors }` body on validation failure; surface the
 * offending node/field rather than a raw JSON blob.
 */
async function readPromptError(
  response: Response,
): Promise<{ message: string; error: Error }> {
  const text = await response.text().catch(() => '');
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  const body = (parsed ?? {}) as {
    error?: { message?: string; details?: string };
    node_errors?: Record<string, ComfyNodeError>;
  };
  const nodeErrors = body.node_errors ?? {};
  const parts: string[] = [];
  if (body.error?.message) {
    parts.push(body.error.message + (body.error.details ? `（${body.error.details}）` : ''));
  }
  for (const [nodeId, nodeError] of Object.entries(nodeErrors)) {
    const label = nodeError.class_type ? `${nodeError.class_type} #${nodeId}` : `节点 #${nodeId}`;
    for (const e of nodeError.errors ?? []) {
      parts.push(`${label}: ${e.message ?? e.type ?? '输入无效'}${e.details ? `（${e.details}）` : ''}`);
    }
  }
  const message = parts.length
    ? `ComfyUI 拒绝了该工作流：\n${parts.join('\n')}`
    : `ComfyUI /prompt ${response.status} ${response.statusText}${text ? `: ${text}` : ''}`;
  const error =
    parts.length && Object.keys(nodeErrors).length
      ? new ComfyValidationError(message, nodeErrors)
      : new Error(message);
  return { message, error };
}

/**
 * Subscribe to ComfyUI's WS event stream for live progress/preview while a run
 * is in flight. Best-effort: returns the socket (or null if WS can't be opened)
 * so the caller can close it; terminal results still come from /history.
 */
function openProgressSocket(
  baseUrl: string,
  clientId: string,
  promptId: string,
  emit: (p: Partial<ComfyRunProgress>) => void,
  signal?: AbortSignal,
): WebSocket | null {
  if (typeof WebSocket === 'undefined') return null;
  let wsUrl: string;
  try {
    const u = new URL(baseUrl);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = `${u.pathname.replace(/\/+$/, '')}/ws`;
    u.searchParams.set('clientId', clientId);
    wsUrl = u.toString();
  } catch {
    return null;
  }
  let socket: WebSocket;
  try {
    socket = new WebSocket(wsUrl);
  } catch {
    return null;
  }
  socket.binaryType = 'arraybuffer';
  signal?.addEventListener('abort', () => socket.close(), { once: true });
  socket.onmessage = (ev) => {
    if (typeof ev.data !== 'string') {
      // Binary preview frame: first 8 bytes are a header, rest is image bytes.
      try {
        const bytes = new Uint8Array(ev.data as ArrayBuffer);
        const blob = new Blob([bytes.slice(8)], { type: 'image/jpeg' });
        const reader = new FileReader();
        reader.onload = () => emit({ preview: String(reader.result) });
        reader.readAsDataURL(blob);
      } catch {
        /* ignore malformed preview */
      }
      return;
    }
    try {
      const msg = JSON.parse(ev.data) as { type?: string; data?: Record<string, unknown> };
      const data = msg.data ?? {};
      if (data.prompt_id && data.prompt_id !== promptId) return;
      if (msg.type === 'progress') {
        emit({
          status: 'running',
          value: Number(data.value ?? 0),
          max: Number(data.max ?? 0),
          node: (data.node as string) ?? null,
        });
      } else if (msg.type === 'executing') {
        emit({ status: 'running', node: (data.node as string) ?? null });
      } else if (msg.type === 'execution_error') {
        emit({ status: 'error', error: String(data.exception_message ?? '执行出错') });
      }
    } catch {
      /* ignore non-JSON frames */
    }
  };
  socket.onerror = () => {
    /* fall back to polling silently */
  };
  return socket;
}

/** Poll /history until the prompt completes; resolves with its output assets. */
async function pollHistory(
  baseUrl: string,
  promptId: string,
  authHeaders: Record<string, string>,
  emit: (p: Partial<ComfyRunProgress>) => void,
  signal?: AbortSignal,
): Promise<ComfyOutputImage[]> {
  for (let i = 0; i < 600; i += 1) {
    await delay(1000, signal);
    const historyResponse = await fetch(
      `${baseUrl}/history/${encodeURIComponent(promptId)}`,
      { headers: authHeaders, signal },
    );
    if (!historyResponse.ok) continue;
    const history = (await historyResponse.json()) as Record<string, ComfyHistoryEntry>;
    const entry = history[promptId];
    if (!entry) continue;
    const statusStr = entry.status?.status_str;
    if (statusStr === 'error') {
      const message = errorFromHistory(entry) ?? 'ComfyUI 执行出错。';
      emit({ status: 'error', error: message });
      throw new Error(message);
    }
    // Authoritative completion signal — only then is the output set final.
    if (entry.status?.completed) {
      const images = imagesFromHistory(entry, baseUrl);
      emit({ status: 'done', images });
      return images;
    }
  }
  emit({ status: 'error', error: 'ComfyUI job timed out.' });
  throw new Error('ComfyUI job timed out before an image was ready.');
}

/** Extract a readable error message from a failed history entry, if present. */
function errorFromHistory(entry: ComfyHistoryEntry): string | null {
  for (const msg of entry.status?.messages ?? []) {
    if (!Array.isArray(msg) || msg[0] !== 'execution_error') continue;
    const data = msg[1] as { exception_message?: string; node_type?: string } | undefined;
    if (data?.exception_message) {
      return `${data.node_type ? `${data.node_type}: ` : ''}${data.exception_message}`;
    }
  }
  return null;
}

/**
 * Interrupt the currently running prompt on the server. Front-end abort only
 * cancels the fetch; this stops the server-side job. Best-effort.
 */
export async function interruptComfyRun(baseUrl = comfyBaseUrl()): Promise<void> {
  try {
    await fetch(`${baseUrl}/interrupt`, {
      method: 'POST',
      headers: comfyAuthHeaders(),
    });
  } catch {
    /* non-fatal */
  }
}

function imagesFromHistory(entry: ComfyHistoryEntry, baseUrl: string): ComfyOutputImage[] {
  const out: ComfyOutputImage[] = [];
  const collect = (assets: ComfyOutputAsset[] | undefined, kind: ComfyOutputImage['kind']) => {
    for (const asset of assets ?? []) {
      out.push({
        filename: asset.filename,
        subfolder: asset.subfolder,
        type: asset.type,
        kind,
        url: comfyViewUrl(baseUrl, asset),
      });
    }
  };
  for (const node of Object.values(entry.outputs ?? {})) {
    collect(node.images, 'image');
    collect(node.gifs, 'video');
    collect(node.audio, 'audio');
  }
  return out;
}

/** Quick reachability probe for the configured ComfyUI server. */
export async function pingComfyUi(
  baseUrl = comfyBaseUrl(),
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/system_stats`, {
      headers: comfyAuthHeaders(),
      signal,
    });
    return response.ok;
  } catch {
    return false;
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
