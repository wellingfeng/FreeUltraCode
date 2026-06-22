import type { Locale } from '@/lib/i18n';
import type {
  GameSkillCategory,
  GameSkillCommand,
  GameSkillProtocol,
  LocalizedText,
} from '@/lib/gameSkill';

export type CapabilityKind = 'skill' | 'workflow' | 'command' | 'mode';

export type CapabilitySurface =
  | 'slashMenu'
  | 'gameSkillMenu'
  | 'settingsCommands'
  | 'projectSettingsCommands'
  | 'cliHelp';

export type CapabilityCategory = GameSkillCategory | 'generic';

export type CapabilityResourceKind = 'workflow' | 'protocol' | 'script' | 'doc';

export interface CapabilityTriggers {
  slash: string[];
  aliases: string[];
}

export interface CapabilityContract {
  description: string;
  required?: string[];
  optional?: string[];
  artifacts?: string[];
}

export interface CapabilityResource {
  kind: CapabilityResourceKind;
  path: string;
  description?: string;
}

export interface CapabilityGating {
  gameProjectOnly?: boolean;
  engines?: Array<'unreal' | 'unity' | 'godot' | 'cocos' | 'web'>;
  requiresProvider?: boolean;
}

export interface CapabilityManifest {
  id: string;
  version: string;
  kind: CapabilityKind;
  category: CapabilityCategory;
  command: GameSkillCommand;
  triggers: CapabilityTriggers;
  inputs: CapabilityContract;
  outputs: CapabilityContract;
  requiredSettings: string[];
  resources: CapabilityResource[];
  verification: string;
  rollback: string;
  surfaces: CapabilitySurface[];
  gating?: CapabilityGating;
  protocol?: GameSkillProtocol;
}

export function capabilityCommand(manifest: CapabilityManifest): GameSkillCommand {
  return manifest.command;
}

export function capabilityCommandName(manifest: CapabilityManifest): string {
  return manifest.command.name;
}

export function hasCapabilitySurface(
  manifest: CapabilityManifest,
  surface: CapabilitySurface,
): boolean {
  return manifest.surfaces.includes(surface);
}

export function localizedText(
  value: LocalizedText,
  locale: Locale,
): string {
  return value[locale] ?? value['en-US'] ?? value['zh-CN'] ?? '';
}
