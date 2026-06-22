import defaultsConfig from '@/config/personalInstructionsDefaults.json';
import type { GatewaySelection } from './ir';

/**
 * Pure formatting helpers for user-level personal defaults. Storage lives in
 * lib/composerStorage so runtime code can stay browser-agnostic.
 */
export type PersonalInstructionsByModel = Record<string, string>;

interface PersonalInstructionsDefaultsConfig {
  requiredSection: string[];
  base: string[];
  profiles: Record<string, string[]>;
  adapterProfiles: Record<string, string>;
  providerProfiles: Record<string, string>;
  defaultSelections: Array<Partial<GatewaySelection>>;
}

const PERSONAL_INSTRUCTIONS_DEFAULTS =
  defaultsConfig as PersonalInstructionsDefaultsConfig;

const LARKDOC_PERSONAL_INSTRUCTIONS_SECTION =
  PERSONAL_INSTRUCTIONS_DEFAULTS.requiredSection.join('\n');

const BASE_PERSONAL_INSTRUCTIONS_SAMPLE =
  PERSONAL_INSTRUCTIONS_DEFAULTS.base.join('\n');

const DEFAULT_PERSONAL_INSTRUCTIONS_SELECTIONS =
  PERSONAL_INSTRUCTIONS_DEFAULTS.defaultSelections;

function normalized(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

/**
 * Personalization is bucketed by the three runtime adapters only
 * (Claude Code / Codex / Gemini). Provider/channel/model no longer split the
 * buckets, so any unknown adapter folds into the Claude Code bucket.
 */
export type PersonalInstructionsAdapter = 'claude-code' | 'codex' | 'gemini';

export const PERSONAL_INSTRUCTIONS_ADAPTERS: PersonalInstructionsAdapter[] = [
  'claude-code',
  'codex',
  'gemini',
];

export function normalizePersonalInstructionsAdapter(
  adapter: string | null | undefined,
): PersonalInstructionsAdapter {
  const value = normalized(adapter);
  if (value === 'codex') return 'codex';
  if (value === 'gemini') return 'gemini';
  return 'claude-code';
}

/** Canonical selection for an adapter bucket (used by the settings UI). */
export function personalInstructionsCanonicalSelection(
  adapter: string | null | undefined,
): GatewaySelection {
  return {
    adapter: normalizePersonalInstructionsAdapter(adapter),
    modelClass: 'default',
    systemDefault: true,
  };
}

function defaultProfileId(
  selection: Partial<GatewaySelection> | null | undefined,
): string {
  const providerId = normalized(selection?.providerId);
  const channelId = normalized(selection?.channelId);
  const providerProfiles = PERSONAL_INSTRUCTIONS_DEFAULTS.providerProfiles;
  const channelProfile =
    providerId && channelId ? providerProfiles[`${providerId}/${channelId}`] : '';
  if (channelProfile) return channelProfile;
  const providerProfile = providerId ? providerProfiles[providerId] : '';
  if (providerProfile) return providerProfile;
  const adapter = normalized(selection?.adapter) || 'claude-code';
  return (
    PERSONAL_INSTRUCTIONS_DEFAULTS.adapterProfiles[adapter] ??
    PERSONAL_INSTRUCTIONS_DEFAULTS.adapterProfiles['claude-code'] ??
    'claude-code'
  );
}

function profileSuffix(profileId: string): string {
  return PERSONAL_INSTRUCTIONS_DEFAULTS.profiles[profileId]?.join('\n') ?? '';
}

function decodeKeyPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function personalInstructionsKey(
  selection: Partial<GatewaySelection> | null | undefined,
): string {
  // One bucket per adapter. Provider, channel and model no longer split the
  // key, so every Claude Code / Codex / Gemini selection maps to a single slot.
  return normalizePersonalInstructionsAdapter(selection?.adapter);
}

export function selectionFromPersonalInstructionsKey(
  key: string,
): GatewaySelection | null {
  const trimmed = key?.trim();
  if (!trimmed) return null;
  // Legacy keys looked like "adapter|provider|channel|model"; keep reading the
  // leading adapter segment so old storage migrates cleanly.
  const adapterPart = trimmed.split('|')[0] ?? trimmed;
  return personalInstructionsCanonicalSelection(decodeKeyPart(adapterPart));
}

export function personalInstructionsForSelection(
  byModel: PersonalInstructionsByModel | null | undefined,
  selection: Partial<GatewaySelection> | null | undefined,
): string {
  return byModel?.[personalInstructionsKey(selection)] ?? '';
}

export function withPersonalInstructionsForSelection(
  byModel: PersonalInstructionsByModel,
  selection: Partial<GatewaySelection> | null | undefined,
  instructions: string,
): PersonalInstructionsByModel {
  const key = personalInstructionsKey(selection);
  if (!instructions.trim()) {
    const next = { ...byModel };
    delete next[key];
    return next;
  }
  return {
    ...byModel,
    [key]: ensureRequiredPersonalInstructions(instructions),
  };
}

export function ensureRequiredPersonalInstructions(instructions: string): string {
  const trimmed = instructions.trim();
  if (!trimmed) return '';
  const hasLarkDoc = /\blarkdoc\b/i.test(trimmed);
  const hasNoEnterprisePermission = /企业权限|enterprise permission/i.test(trimmed);
  if (hasLarkDoc && hasNoEnterprisePermission) return trimmed;
  return `${trimmed}\n\n${LARKDOC_PERSONAL_INSTRUCTIONS_SECTION}`;
}

export function personalInstructionsSample(
  selection: Partial<GatewaySelection> | null | undefined,
): string {
  const suffix = profileSuffix(defaultProfileId(selection));
  return ensureRequiredPersonalInstructions(
    `${BASE_PERSONAL_INSTRUCTIONS_SAMPLE}${suffix}`,
  );
}

export function defaultPersonalInstructionsByModel(
  selections: ReadonlyArray<Partial<GatewaySelection> | null | undefined> = [],
): PersonalInstructionsByModel {
  const out: PersonalInstructionsByModel = {};
  for (const selection of [
    ...DEFAULT_PERSONAL_INSTRUCTIONS_SELECTIONS,
    ...selections,
  ]) {
    if (!selection) continue;
    const key = personalInstructionsKey(selection);
    if (out[key]?.trim()) continue;
    out[key] = personalInstructionsSample(selection);
  }
  return out;
}

export function shouldInjectPersonalInstructions(): boolean {
  // All three adapters (Claude Code / Codex / Gemini) now receive the
  // user's personal defaults. Codex is no longer skipped.
  return true;
}

export function personalInstructionsBlock(
  instructions: string | null | undefined,
  adapter?: string | null,
): string {
  void adapter;
  if (!shouldInjectPersonalInstructions()) return '';
  const trimmed = instructions?.trim();
  if (!trimmed) return '';
  return [
    '',
    '---',
    '【用户个人默认指令（低优先级）】',
    '以下内容来自「设置 > 个性化」。请尽量遵守；若与 UltraGameStudio 系统规则、workflow 模式约束、工具安全规则或本轮用户最新指令冲突，以后者为准。',
    trimmed,
  ].join('\n');
}

export function appendPersonalInstructions(
  prompt: string,
  instructions: string | null | undefined,
  adapter?: string | null,
): string {
  const block = personalInstructionsBlock(instructions, adapter);
  return block ? `${prompt}${block}` : prompt;
}
