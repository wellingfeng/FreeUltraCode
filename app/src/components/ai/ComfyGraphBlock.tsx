import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import { Boxes, Maximize2, Play, Square, AlertTriangle } from 'lucide-react';
import CopyButton from './CopyButton';
import RawCodeBlock from './RawCodeBlock';
import { useStore } from '@/store/useStore';
import { t } from '@/lib/i18n';
import {
  comfyToFlow,
  comfyGraphStats,
  type ComfyFlowNodeData,
} from '@/core/comfyToFlow';
import {
  parseComfyGraph,
  runComfyGraph,
  interruptComfyRun,
  randomizeSeeds,
  comfyBaseUrl,
  type ComfyOutputImage,
  type ComfyPromptGraph,
  type ComfyRunProgress,
} from '@/lib/comfyui';

/**
 * Chat-stream renderer for a fenced ` ```comfyui ` block: a compact, read-only
 * mini node-graph (the analogue of MermaidBlock for ComfyUI). Clicking 展开
 * opens a full-screen editor overlay that takes over the message stream, where
 * each node can be inspected/edited and the graph re-run against the local
 * ComfyUI server. Routed from CodeBlock when the fence language is `comfyui`.
 *
 * The block body (raw JSON) is the single source of truth — editing writes a
 * new graph back through `onEdit`, mirroring how every other embedded block
 * keeps its state in the message text.
 */

/** Custom React Flow node: a small ComfyUI-style card. */
function ComfyNodeCard({ data }: NodeProps) {
  const d = data as ComfyFlowNodeData;
  return (
    <div className="rounded-md border border-[var(--code-border)] bg-[var(--code-bg)] text-[11px] shadow-sm">
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-[var(--code-border)] !bg-accent"
      />
      <div className="truncate rounded-t-md border-b border-[var(--code-border)] bg-[var(--code-header-bg)] px-2 py-1 font-medium text-fg-faint">
        {d.title}
      </div>
      {!d.compact && d.fields.length > 0 && (
        <div className="space-y-0.5 px-2 py-1">
          {d.fields.slice(0, 5).map((f) => (
            <div key={f.key} className="flex gap-1.5 leading-tight">
              <span className="shrink-0 text-fg-dim">{f.key}</span>
              <span className="truncate text-fg-faint">{f.value}</span>
            </div>
          ))}
          {d.fields.length > 5 && (
            <div className="text-fg-dim">…+{d.fields.length - 5}</div>
          )}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-[var(--code-border)] !bg-accent"
      />
    </div>
  );
}

const nodeTypes: NodeTypes = { comfy: ComfyNodeCard };

export interface ComfyGraphBlockProps {
  /** Raw block body (ComfyUI prompt-graph JSON). */
  code: string;
  /** Persist an edited graph back into the owning message text, if editable. */
  onEdit?: (nextBody: string) => void;
}

export default function ComfyGraphBlock({ code, onEdit }: ComfyGraphBlockProps) {
  const locale = useStore((s) => s.locale);
  const graph = useMemo(() => parseComfyGraph(code), [code]);
  const [expanded, setExpanded] = useState(false);

  if (!graph) {
    return (
      <div className="ai-comfy my-2 overflow-hidden rounded-lg border border-[var(--code-border)]">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--code-border)] bg-[var(--code-header-bg)] px-3 py-1.5">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-fg-faint">
            <AlertTriangle size={13} className="shrink-0 text-danger" />
            <span className="truncate">{t(locale, 'comfy.parseFailed')}</span>
          </span>
          <CopyButton value={code} label={t(locale, 'chat.copy')} className="px-1 py-0.5" />
        </div>
        <RawCodeBlock raw={code} language="json" compact className="border-x-0 border-b-0" />
      </div>
    );
  }

  return (
    <>
      <ComfyMiniPreview graph={graph} onExpand={() => setExpanded(true)} />
      {expanded && (
        <ComfyEditorOverlay
          graph={graph}
          editable={!!onEdit}
          onSave={(body) => {
            onEdit?.(body);
            setExpanded(false);
          }}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
}

/**
 * Shared run controller for both the inline preview and the full editor. Wires
 * progress, server-side interrupt, and abort into one place so the two surfaces
 * behave identically. `randomizeSeed` rerolls KSampler seeds each run so a
 * repeat produces a fresh image (mirroring ComfyUI's control_after_generate).
 */
function useComfyRun() {
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [progress, setProgress] = useState<ComfyRunProgress | null>(null);
  const [outputs, setOutputs] = useState<ComfyOutputImage[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (graph: ComfyPromptGraph, opts: { randomizeSeed?: boolean } = {}) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setRunError('');
      setOutputs([]);
      setProgress(null);
      try {
        const payload = opts.randomizeSeed ? randomizeSeeds(graph) : graph;
        const result = await runComfyGraph(payload, {
          baseUrl: comfyBaseUrl(),
          signal: controller.signal,
          onProgress: setProgress,
        });
        setOutputs(result);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setRunError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    void interruptComfyRun(comfyBaseUrl());
  }, []);

  return { running, runError, progress, outputs, run, cancel };
}

/** Render a run's terminal outputs (images, video, audio) in a compact grid. */
function ComfyOutputs({ outputs }: { outputs: ComfyOutputImage[] }) {
  if (outputs.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-2 border-t border-[var(--code-border)] p-2 sm:grid-cols-3">
      {outputs.map((o) =>
        o.kind === 'video' ? (
          <video
            key={o.url}
            src={o.url}
            controls
            loop
            className="w-full rounded border border-[var(--code-border)]"
          />
        ) : o.kind === 'audio' ? (
          <audio key={o.url} src={o.url} controls className="col-span-full w-full" />
        ) : (
          <img
            key={o.url}
            src={o.url}
            alt={o.filename}
            className="w-full rounded border border-[var(--code-border)]"
          />
        ),
      )}
    </div>
  );
}

/** Inline live-progress strip shown while a run is in flight. */
function ComfyProgress({
  progress,
  locale,
}: {
  progress: ComfyRunProgress | null;
  locale: ReturnType<typeof useStore.getState>['locale'];
}) {
  if (!progress) return null;
  const pct =
    progress.max > 0 ? Math.round((progress.value / progress.max) * 100) : null;
  return (
    <div className="flex items-center gap-2 border-t border-[var(--code-border)] px-3 py-2 text-xs text-fg-faint">
      {progress.preview && (
        <img
          src={progress.preview}
          alt=""
          className="h-10 w-10 shrink-0 rounded border border-[var(--code-border)] object-cover"
        />
      )}
      <span className="min-w-0 flex-1 truncate">
        {progress.node
          ? `${t(locale, 'comfy.running')} · ${progress.node}`
          : t(locale, 'comfy.running')}
        {pct !== null ? ` · ${pct}%` : ''}
      </span>
      {pct !== null && (
        <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-[var(--code-border)]">
          <span
            className="block h-full rounded-full bg-accent transition-all"
            style={{ width: `${pct}%` }}
          />
        </span>
      )}
    </div>
  );
}

/** Collapsed inline mini-graph shown in the message stream. */
function ComfyMiniPreview({
  graph,
  onExpand,
}: {
  graph: ComfyPromptGraph;
  onExpand: () => void;
}) {
  const locale = useStore((s) => s.locale);
  const { nodes, edges } = useMemo(() => comfyToFlow(graph), [graph]);
  const stats = useMemo(() => comfyGraphStats(graph), [graph]);
  const { running, runError, progress, outputs, run, cancel } = useComfyRun();

  return (
    <div className="ai-comfy my-2 overflow-hidden rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--code-border)] bg-[var(--code-header-bg)] px-3 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-fg-faint">
          <Boxes size={13} className="shrink-0 text-accent" />
          <span className="truncate">
            ComfyUI · {stats.nodes} {t(locale, 'comfy.nodes')} · {stats.edges} {t(locale, 'comfy.edges')}
          </span>
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {running ? (
            <button
              type="button"
              onClick={cancel}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-danger hover:bg-[var(--code-border)]"
            >
              <Square size={11} />
              {t(locale, 'comfy.stop')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void run(graph, { randomizeSeed: true })}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-fg-faint hover:bg-[var(--code-border)] hover:text-fg"
            >
              <Play size={12} />
              {t(locale, 'comfy.run')}
            </button>
          )}
          <button
            type="button"
            onClick={onExpand}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-fg-faint hover:bg-[var(--code-border)] hover:text-fg"
          >
            <Maximize2 size={12} />
            {t(locale, 'chat.expand')}
          </button>
        </div>
      </div>
      <div className="ai-comfy__mini h-44" aria-label={t(locale, 'comfy.preview')}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            zoomOnScroll={false}
            panOnScroll={false}
            panOnDrag={false}
            zoomOnDoubleClick={false}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.1}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      {running && <ComfyProgress progress={progress} locale={locale} />}
      {runError && (
        <div className="whitespace-pre-wrap border-t border-[var(--code-border)] px-3 py-2 text-xs text-danger">
          {runError}
        </div>
      )}
      <ComfyOutputs outputs={outputs} />
    </div>
  );
}

/**
 * Full-screen editor that takes over the message stream. Shows the editable
 * graph, a per-node parameter panel, and Run/Save/Close actions. Editing a
 * node's literal inputs mutates a draft graph; Save serializes it back through
 * onSave so the owning message's block body updates.
 */
function ComfyEditorOverlay({
  graph,
  editable,
  onSave,
  onClose,
}: {
  graph: ComfyPromptGraph;
  editable: boolean;
  onSave: (body: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ComfyPromptGraph>(() =>
    structuredClone(graph),
  );
  const locale = useStore((s) => s.locale);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { running, runError, progress, outputs, run, cancel } = useComfyRun();

  // Escape closes the overlay, matching the rest of the app's dialog behavior.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { nodes, edges } = useMemo(
    () => comfyToFlow(draft, { compact: true }),
    [draft],
  );
  const selectedNode = selectedId ? draft[selectedId] : null;

  // Mount the editor into the chat stream surface so 展开 fills the entire
  // info-stream (full screen of the message area) rather than being clipped to
  // the message bubble that owns this block. Falls back to in-place rendering
  // when the surface isn't present (e.g. the compact dock layout).
  const [surface, setSurface] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSurface(document.getElementById('ugs-stream-surface'));
  }, []);

  const updateField = useCallback(
    (nodeId: string, key: string, raw: string) => {
      setDraft((prev) => {
        const next = structuredClone(prev);
        const node = next[nodeId];
        if (!node) return prev;
        node.inputs[key] = coerceFieldValue(raw, node.inputs[key]);
        return next;
      });
    },
    [],
  );

  const overlay = (
    <div className="ai-comfy-overlay absolute inset-0 z-30 flex flex-col bg-[var(--bg)]">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
          <Boxes size={15} className="text-accent" />
          {t(locale, 'comfy.nodeEditor')}
        </span>
        <div className="flex items-center gap-1.5">
          {running ? (
            <button
              type="button"
              onClick={cancel}
              className="flex items-center gap-1 rounded border border-danger/50 px-2.5 py-1 text-xs font-medium text-danger"
            >
              <Square size={11} />
              {t(locale, 'comfy.stop')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void run(draft, { randomizeSeed: true })}
              className="flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-xs font-medium text-white"
            >
              <Play size={12} />
              {t(locale, 'comfy.run')}
            </button>
          )}
          {editable && (
            <button
              type="button"
              onClick={() => onSave(JSON.stringify(draft, null, 2))}
              className="rounded border border-border px-2.5 py-1 text-xs text-fg-faint hover:text-fg"
            >
              {t(locale, 'comfy.saveAndReturn')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-2.5 py-1 text-xs text-fg-faint hover:text-fg"
          >
            {t(locale, 'comfy.back')}
          </button>
        </div>
      </div>
      {running && <ComfyProgress progress={progress} locale={locale} />}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={(_, n) => setSelectedId(n.id)}
              onPaneClick={() => setSelectedId(null)}
              nodesDraggable
              nodesConnectable={false}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.1}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>

        <aside className="w-72 shrink-0 overflow-y-auto border-l border-border p-3 text-xs">
          {selectedNode ? (
            <div className="space-y-2">
              <div className="font-medium text-fg">
                {selectedNode._meta?.title?.trim() || selectedNode.class_type}
              </div>
              <div className="text-fg-dim">{selectedNode.class_type}</div>
              {Object.entries(selectedNode.inputs).map(([key, value]) =>
                Array.isArray(value) ? (
                  <div key={key} className="text-fg-dim">
                    <span className="text-fg-faint">{key}</span>
                    <span className="ml-1">← {value[0]}[{value[1]}]</span>
                  </div>
                ) : (
                  <label key={key} className="block space-y-0.5">
                    <span className="text-fg-faint">{key}</span>
                    <input
                      value={value === null ? '' : String(value)}
                      disabled={!editable}
                      onChange={(e) =>
                        selectedId && updateField(selectedId, key, e.target.value)
                      }
                      className="w-full rounded border border-border bg-[var(--code-bg)] px-1.5 py-1 text-fg disabled:opacity-60"
                    />
                  </label>
                ),
              )}
            </div>
          ) : (
            <div className="text-fg-dim">{t(locale, 'comfy.clickNodeToEdit')}</div>
          )}

          {runError && (
            <div className="mt-3 whitespace-pre-wrap rounded border border-danger/40 bg-danger/10 p-2 text-danger">
              {runError}
            </div>
          )}
          {outputs.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="text-fg-faint">{t(locale, 'comfy.result')}</div>
              {outputs.map((o) =>
                o.kind === 'video' ? (
                  <video
                    key={o.url}
                    src={o.url}
                    controls
                    loop
                    className="w-full rounded border border-border"
                  />
                ) : o.kind === 'audio' ? (
                  <audio key={o.url} src={o.url} controls className="w-full" />
                ) : (
                  <img
                    key={o.url}
                    src={o.url}
                    alt={o.filename}
                    className="w-full rounded border border-border"
                  />
                ),
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );

  return surface ? createPortal(overlay, surface) : overlay;
}

/**
 * Coerce an edited string back to the field's original primitive type so the
 * graph stays valid for POST /prompt (numbers stay numbers, etc.).
 */
function coerceFieldValue(raw: string, previous: unknown): string | number | boolean | null {
  if (typeof previous === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : previous;
  }
  if (typeof previous === 'boolean') {
    return raw === 'true' || raw === '1';
  }
  return raw;
}
