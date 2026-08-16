export const RUNTIME_ADAPTERS = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'kimi', label: 'Kimi Code' },
  { id: 'deepseek-harness', label: 'DeepSeek Harness' },
  { id: 'zcode', label: 'ZCode / GLM' },
] as const;

export type RuntimeAdapterId = (typeof RUNTIME_ADAPTERS)[number]['id'];

export function runtimeAdapterLabel(adapter: string): string {
  return RUNTIME_ADAPTERS.find((item) => item.id === adapter)?.label ?? adapter;
}
