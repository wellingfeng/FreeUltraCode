import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ExternalLink,
  Gamepad2,
  Globe2,
  Maximize2,
  RotateCcw,
} from 'lucide-react';
import CopyButton from './CopyButton';
import RawCodeBlock from './RawCodeBlock';
import { useStore } from '@/store/useStore';
import { t } from '@/lib/i18n';
import { openExternal } from '@/lib/tauri';
import {
  parseWorldModelSpec,
  worldModelProviderById,
  type WorldModelInteractivity,
  type WorldModelProviderId,
  type WorldModelSpec,
} from '@/lib/worldModel';

const ModelViewer = lazy(() => import('./ModelViewer'));

/**
 * Chat-stream renderer for a fenced ```worldmodel block: the interactive
 * playable-world analogue of ComfyGraphBlock/ModelViewer. It shows a compact
 * card in the stream and, on 展开, opens a full-screen interactive panel where
 * the world can actually be played:
 *  - live-session worlds embed a sandboxed iframe (WASD/pointer controls);
 *  - export-3d worlds load the asset into the three.js ModelViewer;
 *  - video-stream worlds play the generated world video.
 * When no playable URL is available yet (research-preview providers), it renders
 * a spec/launch card so the user can open the world session externally.
 *
 * The block body (raw JSON) is the single source of truth — routed here from
 * CodeBlock when the fence language is `worldmodel`.
 */

export interface WorldModelBlockProps {
  /** Raw block body (worldmodel spec JSON, or a bare world prompt). */
  code: string;
  /** Reserved for future inline editing parity with other embedded blocks. */
  onEdit?: (nextBody: string) => void;
}

function resolveProviderId(spec: WorldModelSpec): WorldModelProviderId {
  return spec.provider ?? 'decart-oasis';
}

function interactivityLabel(
  kind: WorldModelInteractivity,
  locale: ReturnType<typeof useStore.getState>['locale'],
): string {
  if (kind === 'live-session') return t(locale, 'world.kind.live');
  if (kind === 'video-stream') return t(locale, 'world.kind.video');
  return t(locale, 'world.kind.export');
}

/** The best playable URL for a spec, honoring the provider interactivity. */
function playableUrl(spec: WorldModelSpec): { url: string; kind: WorldModelInteractivity } | null {
  if (spec.sessionUrl) return { url: spec.sessionUrl, kind: 'live-session' };
  if (spec.assetUrl) return { url: spec.assetUrl, kind: 'export-3d' };
  if (spec.videoUrl) return { url: spec.videoUrl, kind: 'video-stream' };
  return null;
}

function canInlineExport3d(url: string): boolean {
  return /\.(?:glb|gltf|obj|fbx|stl|ply)(?:[?#]|$)/iu.test(url) ||
    /^data:(?:model\/gltf-binary|model\/gltf\+json|application\/octet-stream)/iu.test(url);
}

export default function WorldModelBlock({ code }: WorldModelBlockProps) {
  const locale = useStore((s) => s.locale);
  const cwd = useStore((s) => s.composer.workspace);
  const spec = useMemo(() => parseWorldModelSpec(code), [code]);
  const [expanded, setExpanded] = useState(false);

  if (!spec) {
    return (
      <div className="ai-world my-2 overflow-hidden rounded-lg border border-[var(--code-border)]">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--code-border)] bg-[var(--code-header-bg)] px-3 py-1.5">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-fg-faint">
            <AlertTriangle size={13} className="shrink-0 text-danger" />
            <span className="truncate">{t(locale, 'world.parseFailed')}</span>
          </span>
          <CopyButton value={code} label={t(locale, 'chat.copy')} className="px-1 py-0.5" />
        </div>
        <RawCodeBlock raw={code} language="json" compact className="border-x-0 border-b-0" />
      </div>
    );
  }

  const providerId = resolveProviderId(spec);
  const provider = worldModelProviderById(providerId);
  const playable = playableUrl(spec);
  const title = spec.title?.trim() || provider.label;

  return (
    <>
      <div className="ai-world my-2 overflow-hidden rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)]">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--code-border)] bg-[var(--code-header-bg)] px-3 py-1.5">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-fg-faint">
            <Globe2 size={13} className="shrink-0 text-accent" />
            <span className="truncate">
              {title} · {provider.label} · {interactivityLabel(provider.interactivity, locale)}
            </span>
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-fg-faint hover:bg-[var(--code-border)] hover:text-fg"
            >
              {playable ? <Gamepad2 size={12} /> : <Maximize2 size={12} />}
              {playable ? t(locale, 'world.play') : t(locale, 'chat.expand')}
            </button>
          </div>
        </div>
        <div className="space-y-1.5 px-3 py-2 text-xs text-fg-dim">
          {spec.prompt && <p className="line-clamp-3 whitespace-pre-wrap">{spec.prompt}</p>}
          {spec.controls && (
            <p className="text-fg-faint">
              {t(locale, 'world.controls')}: {spec.controls}
            </p>
          )}
          {!playable ? (
            <p className="flex items-center gap-1 text-fg-faint">
              <AlertTriangle size={11} className="shrink-0 text-danger" />
              {t(locale, 'world.noSession')}
            </p>
          ) : playable.kind === 'export-3d' && !canInlineExport3d(playable.url) ? (
            <p className="flex items-center gap-1 text-fg-faint">
              <ExternalLink size={11} className="shrink-0 text-accent" />
              {t(locale, 'world.externalExport')}
            </p>
          ) : null}
        </div>
      </div>
      {expanded && (
        <WorldModelOverlay
          spec={spec}
          providerId={providerId}
          cwd={cwd}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
}

/**
 * Full-screen interactive panel that takes over the message stream (mounted into
 * #ugs-stream-surface, matching ComfyEditorOverlay). Hosts the actual playable
 * surface: a sandboxed live-session iframe, the 3D viewer, or the world video.
 */
function WorldModelOverlay({
  spec,
  providerId,
  cwd,
  onClose,
}: {
  spec: WorldModelSpec;
  providerId: WorldModelProviderId;
  cwd?: string;
  onClose: () => void;
}) {
  const locale = useStore((s) => s.locale);
  const provider = worldModelProviderById(providerId);
  const playable = playableUrl(spec);
  const [reloadKey, setReloadKey] = useState(0);
  const title = spec.title?.trim() || provider.label;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [surface, setSurface] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSurface(document.getElementById('ugs-stream-surface'));
  }, []);

  const launchExternal = () => {
    const url = playable?.url;
    if (url) void openExternal(url);
    else if (provider.credentialUrl) void openExternal(provider.credentialUrl);
  };

  const overlay = (
    <div className="ai-world-overlay absolute inset-0 z-30 flex flex-col bg-[var(--bg)]">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-fg">
          <Globe2 size={15} className="shrink-0 text-accent" />
          <span className="truncate">{title}</span>
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {playable?.kind === 'live-session' && (
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs text-fg-faint hover:text-fg"
            >
              <RotateCcw size={12} />
              {t(locale, 'world.restart')}
            </button>
          )}
          <button
            type="button"
            onClick={launchExternal}
            className="flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs text-fg-faint hover:text-fg"
          >
            <ExternalLink size={12} />
            {t(locale, 'world.openExternal')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-2.5 py-1 text-xs text-fg-faint hover:text-fg"
          >
            {t(locale, 'comfy.back')}
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {playable?.kind === 'live-session' ? (
          // Sandboxed: third-party live worlds run untrusted JS, so we restrict
          // capabilities to scripts + same-origin streaming and pointer-lock for
          // mouselook, without granting top-navigation or popups.
          <iframe
            key={reloadKey}
            src={playable.url}
            title={title}
            className="h-full w-full border-0 bg-black"
            sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-fullscreen"
            allow="gamepad; pointer-lock; fullscreen; xr-spatial-tracking"
          />
          ) : playable?.kind === 'export-3d' ? (
          canInlineExport3d(playable.url) ? (
            <div className="h-full w-full overflow-auto p-3">
              <Suspense fallback={<div className="p-4 text-xs text-fg-dim">{t(locale, 'world.loading')}</div>}>
                <ModelViewer src={playable.url} label={title} cwd={cwd} />
              </Suspense>
            </div>
          ) : (
            <WorldSpecCard spec={spec} providerId={providerId} onLaunch={launchExternal} />
          )
        ) : playable?.kind === 'video-stream' ? (
          <div className="flex h-full w-full items-center justify-center bg-black p-3">
            <video
              src={playable.url}
              controls
              loop
              autoPlay
              className="max-h-full max-w-full rounded border border-border"
            />
          </div>
        ) : (
          <WorldSpecCard spec={spec} providerId={providerId} onLaunch={launchExternal} />
        )}
      </div>
    </div>
  );

  return surface ? createPortal(overlay, surface) : overlay;
}

/**
 * Shown when there is no playable URL yet (research-preview providers without a
 * public session API). Surfaces the full world spec and a launch button so the
 * user can open the provider's session page once access is granted.
 */
function WorldSpecCard({
  spec,
  providerId,
  onLaunch,
}: {
  spec: WorldModelSpec;
  providerId: WorldModelProviderId;
  onLaunch: () => void;
}) {
  const locale = useStore((s) => s.locale);
  const provider = worldModelProviderById(providerId);
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-3 overflow-auto p-5 text-sm">
      <div className="rounded-lg border border-border bg-panel-2 p-3 text-xs text-fg-dim">
        <span className="flex items-center gap-1.5 font-medium text-fg">
          <AlertTriangle size={13} className="text-danger" />
          {t(locale, 'world.noSessionTitle')}
        </span>
        <p className="mt-1 whitespace-pre-wrap">{provider.note}</p>
      </div>
      <SpecRow label={t(locale, 'world.spec.provider')} value={provider.label} />
      {spec.model && <SpecRow label={t(locale, 'world.spec.model')} value={spec.model} />}
      {spec.prompt && (
        <SpecRow label={t(locale, 'world.spec.prompt')} value={spec.prompt} multiline />
      )}
      {spec.controls && (
        <SpecRow label={t(locale, 'world.controls')} value={spec.controls} />
      )}
      {spec.notes && <SpecRow label={t(locale, 'world.spec.notes')} value={spec.notes} multiline />}
      <button
        type="button"
        onClick={onLaunch}
        className="mt-1 flex items-center justify-center gap-1.5 self-start rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white"
      >
        <ExternalLink size={13} />
        {t(locale, 'world.openExternal')}
      </button>
    </div>
  );
}

function SpecRow({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs font-medium text-fg-faint">{label}</div>
      <div
        className={
          'rounded border border-border bg-[var(--code-bg)] px-2 py-1 text-xs text-fg-dim ' +
          (multiline ? 'whitespace-pre-wrap' : 'truncate')
        }
      >
        {value}
      </div>
    </div>
  );
}
