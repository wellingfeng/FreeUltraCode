import { useMemo, useState } from 'react';
import { Check, ChevronRight, Languages, Loader2, Server, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Locale } from '@/lib/i18n';
import {
  buildTranslationPlan,
  supportedTranslateAgentIds,
  type CapabilityTranslateKind,
} from '@/lib/capabilityTranslate';
import {
  translateCapability,
  tauriAvailable,
  type CapabilityTranslateRequest,
  type CapabilityTranslateResult,
} from '@/lib/tauri';

const KIND_ICON = {
  skill: Sparkles,
  mcp: Server,
  lsp: Languages,
} as const;

export interface CapabilityTranslateDialogProps {
  kind: CapabilityTranslateKind;
  /** 单个 skill 的标题（skill 类型时显示）；mcp/lsp 为空。 */
  title?: string | null;
  projectRoot: string | null;
  locale: Locale;
  onClose: () => void;
  /** 由父组件构造请求；对话框负责勾选目标 agent 与执行。 */
  buildRequest: (targets: string[], overwrite: boolean) => CapabilityTranslateRequest;
}

export default function CapabilityTranslateDialog({
  kind,
  title,
  projectRoot,
  locale,
  onClose,
  buildRequest,
}: CapabilityTranslateDialogProps) {
  const plan = useMemo(() => buildTranslationPlan(kind), [kind]);
  const [selected, setSelected] = useState<string[]>(() =>
    supportedTranslateAgentIds(kind),
  );
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CapabilityTranslateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const zh = locale === 'zh-CN';

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  const run = async () => {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await translateCapability(buildRequest(selected, overwrite));
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const Icon = KIND_ICON[kind];
  const kindLabel =
    kind === 'skill'
      ? zh
        ? 'Skill'
        : 'Skill'
      : kind === 'mcp'
        ? 'MCP'
        : 'LSP';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-panel shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-border-soft px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <Icon size={16} className="shrink-0 text-accent" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-fg">
                {zh ? '一键翻译到其他 agents' : 'Translate to other agents'}
              </div>
              <div className="truncate text-[11px] text-fg-faint">
                {kindLabel}
                {title ? ` · ${title}` : ''}
                {!projectRoot ? ` · ${zh ? '全局' : 'global'}` : ''}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-fg-faint hover:bg-bg-alt hover:text-fg"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {!tauriAvailable() ? (
            <p className="rounded-md border border-border-soft bg-bg-alt px-3 py-3 text-xs text-fg-faint">
              {zh
                ? '一键翻译仅在桌面应用中可用。'
                : 'One-click translation is only available in the desktop app.'}
            </p>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-fg-faint">
                {kind === 'skill'
                  ? zh
                    ? '把该 Skill 的 SKILL.md 写入每个 agent 的原生 skill 目录（global + 项目）。不介入 agent 运行时。'
                    : 'Writes this Skill’s SKILL.md into each agent’s native skill directory (global + project). Never touches the agent runtime.'
                  : kind === 'mcp'
                    ? zh
                      ? '把当前项目已启用的 MCP 写成各 agent 的原生配置：Claude → .mcp.json、Codex → ~/.codex/config.toml、Gemini → ~/.gemini/settings.json。'
                      : 'Writes the enabled MCP servers into each agent’s native config: Claude → .mcp.json, Codex → ~/.codex/config.toml, Gemini → ~/.gemini/settings.json.'
                    : zh
                      ? 'LSP 是运行时能力，无法文本翻译；UGS 会生成统一目录清单（.ugs/lsp-manifest.json），各 agent 复用同一 LSP。'
                      : 'LSP is runtime-bound and can’t be text-translated; UGS writes a unified catalog (.ugs/lsp-manifest.json) that every agent reuses.'}
              </p>

              <div className="mt-4 grid gap-2">
                {plan.agents.map((agent) => {
                  const checked = selected.includes(agent.id);
                  return (
                    <label
                      key={agent.id}
                      className={cn(
                        'flex items-start gap-3 rounded-md border px-3 py-2.5 transition-colors',
                        agent.supported
                          ? 'cursor-pointer border-border bg-bg-alt hover:border-accent'
                          : 'border-border-soft bg-bg-alt/50 opacity-60',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!agent.supported || busy}
                        onChange={() => toggle(agent.id)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-fg">
                          {agent.label}
                        </span>
                        {agent.supported ? null : (
                          <span className="mt-0.5 block text-[11px] text-amber-300">
                            {agent.reason ?? (zh ? '待接入' : 'Not supported')}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>

              {kind === 'skill' ? (
                <label className="mt-3 flex items-center gap-2 text-xs text-fg-dim">
                  <input
                    type="checkbox"
                    checked={overwrite}
                    onChange={(event) => setOverwrite(event.currentTarget.checked)}
                    className="h-4 w-4 accent-accent"
                  />
                  {zh
                    ? '覆盖目标 agent 中已存在的同名 Skill'
                    : 'Overwrite existing same-name Skills in target agents'}
                </label>
              ) : null}

              {error ? (
                <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {error}
                </p>
              ) : null}

              {result ? (
                <div className="mt-3 grid gap-1.5">
                  {result.results.map((item) => (
                    <div
                      key={item.agent}
                      className={cn(
                        'rounded-md border px-3 py-2',
                        item.ok
                          ? 'border-emerald-500/40 bg-emerald-500/10'
                          : 'border-amber-500/40 bg-amber-500/10',
                      )}
                    >
                      <div className="flex items-center gap-2 text-xs">
                        {item.ok ? (
                          <Check size={13} className="shrink-0 text-emerald-300" />
                        ) : (
                          <ChevronRight size={13} className="shrink-0 text-amber-300" />
                        )}
                        <span className="font-semibold text-fg">{item.label}</span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-fg-dim">
                        {item.message}
                        {item.path ? (
                          <span className="block truncate font-mono text-fg-faint">
                            {item.path}
                          </span>
                        ) : null}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-soft px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-bg-alt px-3 py-1.5 text-xs text-fg-dim hover:border-accent hover:text-fg"
          >
            {zh ? '关闭' : 'Close'}
          </button>
          {tauriAvailable() ? (
            <button
              type="button"
              onClick={() => void run()}
              disabled={selected.length === 0 || busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Sparkles size={13} />
              )}
              {busy
                ? zh
                  ? '翻译中...'
                  : 'Translating…'
                : zh
                  ? '翻译'
                  : 'Translate'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
