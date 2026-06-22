// GameSkill catalog authoring helper for UltraGameStudio's own slash commands.
// Every app-introduced command is authored as a `GameSkill` (or a subclass of
// it), then projected to the versioned CapabilityManifest layer. The standard
// six-part protocol (触发词 / 允许工具 / 步骤 / 输出格式 / 停止条件 / 验证方式) stays
// close to the command definition, while downstream surfaces consume manifests.
//
// CONTRACT: Generic prompt shortcuts (/help, /plan, /diagnose, /review,
// /explain, /test) are NOT GameSkills — they are generic CLI semantics, not
// introduced by this app — and stay defined in `capabilityCatalog.ts`.
import type { Locale } from '@/lib/i18n';
import type {
  CapabilityGating,
  CapabilityKind,
  CapabilityManifest,
  CapabilityResource,
  CapabilitySurface,
} from '@/lib/capabilityManifest';

export type LocalizedText = Partial<Record<Locale, string>>;

export type GameSkillCategory =
  | 'orchestration'
  | 'image'
  | 'sprite'
  | 'mesh'
  | 'music'
  | 'video'
  | 'speech'
  | 'worldmodel'
  | 'ui'
  | 'unreal'
  | 'session';

/** The standard six-part protocol every GameSkill must declare. */
export interface GameSkillProtocol {
  /** 触发词 */
  triggers: string;
  /** 允许工具 */
  allowedTools: string;
  /** 步骤 */
  steps: string[];
  /** 输出格式 */
  outputFormat: string;
  /** 停止条件 */
  stopConditions: string;
  /** 验证方式 */
  verification: string;
}

/** The runtime slash-command projection consumed by the data layer. */
export interface GameSkillCommand {
  name: string;
  label: LocalizedText;
  detail: LocalizedText;
  text: LocalizedText;
}

export interface GameSkillConfig {
  name: string;
  category: GameSkillCategory;
  version?: string;
  kind?: CapabilityKind;
  label: LocalizedText;
  detail: LocalizedText;
  insertText?: LocalizedText;
  protocol: GameSkillProtocol;
  inputs?: string[];
  outputs?: string[];
  requiredSettings?: string[];
  resources?: CapabilityResource[];
  rollback?: string;
  surfaces?: CapabilitySurface[];
  gating?: CapabilityGating;
}

const EMPTY_TEXT: LocalizedText = { 'zh-CN': '', 'en-US': '' };

/**
 * Base class for every UltraGameStudio-introduced slash command. Holds the
 * localized presentation fields plus the standard six-part protocol, and
 * projects itself into the runtime SLASH_COMMANDS shape via `toCommand()`.
 */
export class GameSkill {
  readonly name: string;
  readonly category: GameSkillCategory;
  readonly version: string;
  readonly kind: CapabilityKind;
  readonly label: LocalizedText;
  readonly detail: LocalizedText;
  readonly insertText: LocalizedText;
  readonly protocol: GameSkillProtocol;
  readonly inputs: string[];
  readonly outputs: string[];
  readonly requiredSettings: string[];
  readonly resources: CapabilityResource[];
  readonly rollback: string;
  readonly surfaces: CapabilitySurface[];
  readonly gating?: CapabilityGating;

  constructor(config: GameSkillConfig) {
    this.name = config.name;
    this.category = config.category;
    this.version = config.version ?? '1.0.0';
    this.kind = config.kind ?? 'skill';
    this.label = config.label;
    this.detail = config.detail;
    this.insertText = config.insertText ?? EMPTY_TEXT;
    this.protocol = config.protocol;
    this.inputs = config.inputs ?? [];
    this.outputs = config.outputs ?? [];
    this.requiredSettings = config.requiredSettings ?? [];
    this.resources = config.resources ?? [];
    this.rollback = config.rollback ?? '重新运行能力或按最终报告中的恢复步骤处理。';
    this.surfaces = config.surfaces ?? ['slashMenu', 'gameSkillMenu'];
    this.gating = config.gating;
  }

  /** Project into the runtime slash-command data shape. */
  toCommand(): GameSkillCommand {
    return {
      name: this.name,
      label: this.label,
      detail: this.detail,
      text: this.insertText,
    };
  }

  /** Project into the versioned CapabilityManifest data shape. */
  toManifest(): CapabilityManifest {
    const aliases = this.protocol.triggers
      .split(/[、,，]/)
      .map((trigger) => trigger.trim())
      .filter((trigger) => trigger.length > 0 && trigger !== this.name);
    return {
      id: this.name.replace(/^\//, ''),
      version: this.version,
      kind: this.kind,
      category: this.category,
      command: this.toCommand(),
      triggers: {
        slash: [this.name],
        aliases,
      },
      inputs: {
        description: this.inputs.length > 0 ? this.inputs.join('、') : this.protocol.triggers,
        required: this.inputs,
      },
      outputs: {
        description: this.outputs.length > 0 ? this.outputs.join('、') : this.protocol.outputFormat,
        artifacts: this.outputs,
      },
      requiredSettings: this.requiredSettings,
      resources: this.resources,
      verification: this.protocol.verification,
      rollback: this.rollback,
      surfaces: this.surfaces,
      gating: this.gating,
      protocol: this.protocol,
    };
  }
}

export interface ModeStartConfig {
  name: string;
  category: GameSkillCategory;
  label: LocalizedText;
  detail: LocalizedText;
  /** Protocol with `verification` authored WITHOUT the mode-on suffix. */
  protocol: GameSkillProtocol;
}

/**
 * A mode-enter command. Appends the shared "模式已置为开启" verification suffix so
 * every `*-mode-start` skill validates the toggle the same way.
 */
export class ModeStartSkill extends GameSkill {
  constructor(config: ModeStartConfig) {
    super({
      name: config.name,
      category: config.category,
      label: config.label,
      detail: config.detail,
      insertText: EMPTY_TEXT,
      protocol: {
        ...config.protocol,
        verification: `${config.protocol.verification}；模式已置为开启。`,
      },
    });
  }
}

export interface ModeEndConfig {
  name: string;
  category: GameSkillCategory;
  modeNameZh: string;
  label: LocalizedText;
  detail: LocalizedText;
}

/**
 * A mode-exit command. Every `*-mode-end` skill shares the same protocol: it
 * only toggles mode state off and returns to AI coding, so all six parts are
 * derived automatically from the mode name.
 */
export class ModeEndSkill extends GameSkill {
  constructor(config: ModeEndConfig) {
    super({
      name: config.name,
      category: config.category,
      label: config.label,
      detail: config.detail,
      insertText: EMPTY_TEXT,
      protocol: {
        triggers: `${config.name}、退出${config.modeNameZh}`,
        allowedTools: '无（仅切换模式状态）',
        steps: [`关闭${config.modeNameZh}，回到 AI 编程。`],
        outputFormat: '模式已退出的确认。',
        stopConditions: '模式关闭即结束。',
        verification: '后续消息不再走该模式；模式状态为关闭。',
      },
    });
  }
}
