import { GAME_SKILLS } from "@/lib/gameSkillRegistry";
import type { GameSkillCommand } from "@/lib/gameSkill";
import type {
  CapabilityGating,
  CapabilityManifest,
  CapabilityResource,
  CapabilitySurface,
} from "@/lib/capabilityManifest";
import { isAppSlashCommandEnabled } from "@/lib/featureFlags";

const CAPABILITY_SURFACE_ORDER: CapabilitySurface[] = [
  "slashMenu",
  "gameSkillMenu",
  "settingsCommands",
  "projectSettingsCommands",
  "cliHelp",
];

function commandEnabled(name: string): boolean {
  return isAppSlashCommandEnabled(name);
}

const SETTINGS_COMMAND_NAMES = [
  "/studio",
  "/image-to-game",
  "/music",
  "/music-mode-start",
  "/music-mode-end",
  "/image-mode-start",
  "/image-mode-end",
  "/video-to-frames",
  "/comfyui-mode-start",
  "/comfyui-mode-end",
  "/worldmodel",
  "/worldmodel-mode-start",
  "/worldmodel-mode-end",
  "/screenshot",
  "/screenshot-gif",
] as const;

const GAME_PROJECT_SETTINGS_COMMAND_NAMES = [
  "/game",
  "/image-to-game",
  "/gdd-mode-start",
  "/gdd-mode-end",
  "/game-template-skill",
  "/game-debug-skill",
  "/game-verify-report",
  "/mesh-mode-start",
  "/mesh-mode-end",
  "/mesh-search",
  "/sprite",
  "/sprite-mode-start",
  "/sprite-mode-end",
  "/blueprint-mode-start",
  "/blueprint-mode-end",
  "/metahuman-mode-start",
  "/metahuman-mode-end",
  "/ui-mode-start",
  "/ui-mode-end",
] as const;

const CLI_HELP_COMMAND_NAMES = ["/studio"] as const;

const ENABLED_SETTINGS_COMMAND_NAMES =
  SETTINGS_COMMAND_NAMES.filter(commandEnabled);
const ENABLED_CLI_HELP_COMMAND_NAMES =
  CLI_HELP_COMMAND_NAMES.filter(commandEnabled);

const GENERIC_PROMPT_SHORTCUTS: GameSkillCommand[] = [
  {
    name: "/help",
    label: { "zh-CN": "帮助", "en-US": "Help" },
    detail: {
      "zh-CN": "列出当前可用 command / skill",
      "en-US": "List available commands and skills",
    },
    text: {
      "zh-CN":
        "列出当前可用的 slash command 和 Skill，按用途分组，并给出每个条目的触发词和适用场景。",
      "en-US":
        "List the available slash commands and skills, grouped by use case, with each trigger and when to use it.",
    },
  },
  {
    name: "/plan",
    label: { "zh-CN": "计划", "en-US": "Plan" },
    detail: {
      "zh-CN": "先拆步骤，再执行",
      "en-US": "Break down steps before acting",
    },
    text: {
      "zh-CN": "先给出简短执行计划，再按计划完成任务；只保留必要步骤和风险点。",
      "en-US":
        "Start with a short execution plan, then complete the task; keep only necessary steps and risks.",
    },
  },
  {
    name: "/diagnose",
    label: { "zh-CN": "诊断", "en-US": "Diagnose" },
    detail: {
      "zh-CN": "复现 -> 根因 -> 修复 -> 验证",
      "en-US": "Reproduce -> root cause -> fix -> verify",
    },
    text: {
      "zh-CN":
        "诊断这个问题：先复现或定位触发条件，再找根因，最后给出修复和验证结果。",
      "en-US":
        "Diagnose this: reproduce or identify the trigger, find the root cause, then provide the fix and verification.",
    },
  },
  {
    name: "/review",
    label: { "zh-CN": "审查", "en-US": "Review" },
    detail: {
      "zh-CN": "按代码审查视角找风险",
      "en-US": "Review for bugs and risks",
    },
    text: {
      "zh-CN":
        "按代码审查视角检查：优先列出 bug、回归风险和缺失测试，给出文件/位置和修复建议。",
      "en-US":
        "Review this as code: list bugs, regression risks, and missing tests first, with file/location references and fixes.",
    },
  },
  {
    name: "/explain",
    label: { "zh-CN": "解释", "en-US": "Explain" },
    detail: {
      "zh-CN": "解释执行路径和关键依赖",
      "en-US": "Explain flow and dependencies",
    },
    text: {
      "zh-CN": "解释这段内容的执行路径、关键依赖和容易误解的点，结论先行。",
      "en-US":
        "Explain the execution flow, key dependencies, and easy-to-misread parts. Start with the conclusion.",
    },
  },
  {
    name: "/test",
    label: { "zh-CN": "测试", "en-US": "Test" },
    detail: {
      "zh-CN": "补充或运行相关测试",
      "en-US": "Add or run relevant tests",
    },
    text: {
      "zh-CN":
        "为当前任务补充或运行最相关的测试；若失败，说明失败点、可能根因和下一步。",
      "en-US":
        "Add or run the most relevant tests for this task; if they fail, report the failure, likely cause, and next step.",
    },
  },
];

const SETTINGS_COMMAND_NAME_SET = new Set<string>(
  SETTINGS_COMMAND_NAMES.map((name) => name.toLowerCase()),
);
const GAME_PROJECT_SETTINGS_COMMAND_NAME_SET = new Set<string>(
  GAME_PROJECT_SETTINGS_COMMAND_NAMES.map((name) => name.toLowerCase()),
);
const CLI_HELP_COMMAND_NAME_SET = new Set<string>(
  CLI_HELP_COMMAND_NAMES.map((name) => name.toLowerCase()),
);

function orderedSurfaces(
  surfaces: Iterable<CapabilitySurface>,
): CapabilitySurface[] {
  const set = new Set(surfaces);
  return CAPABILITY_SURFACE_ORDER.filter((surface) => set.has(surface));
}

function modeEndCommand(name: string): string | null {
  return name.endsWith("-mode-start")
    ? name.replace(/-mode-start$/, "-mode-end")
    : null;
}

function rollbackForCommand(name: string): string {
  const endCommand = modeEndCommand(name);
  if (endCommand) return `运行 ${endCommand} 退出该模式。`;
  if (name.endsWith("-mode-end"))
    return "重新运行对应的 mode-start 命令恢复模式。";
  return "重新运行能力；若已写入文件，按最终报告中的变更清单回滚。";
}

function requiredSettingsForCommand(name: string): string[] {
  if (
    name === "/image-mode-start" ||
    name === "/sprite" ||
    name === "/sprite-mode-start"
  ) {
    return ["settings.image.defaultProvider"];
  }
  if (name === "/comfyui-mode-start") return ["settings.comfyui"];
  if (name === "/mesh-mode-start") return ["project.mesh.defaultChannel"];
  if (name === "/ui-mode-start") return ["project.ui.defaultChannel"];
  if (name === "/music" || name === "/music-mode-start")
    return ["settings.music.defaultProvider"];
  if (name === "/video" || name === "/video-mode-start")
    return ["settings.video.defaultProvider"];
  if (name === "/tts" || name === "/speech-mode-start")
    return ["settings.speech.defaultProvider"];
  if (name === "/worldmodel" || name === "/worldmodel-mode-start") {
    return ["settings.worldModel.defaultProvider"];
  }
  return [];
}

function resourcesForCommand(name: string): CapabilityResource[] {
  void name;
  return [];
}

function gatingForCommand(name: string): CapabilityGating | undefined {
  if (name.includes("blueprint") || name.includes("metahuman")) {
    return { gameProjectOnly: true, engines: ["unreal"] };
  }
  if (
    GAME_PROJECT_SETTINGS_COMMAND_NAME_SET.has(name.toLowerCase()) &&
    name !== "/image-to-game"
  ) {
    return { gameProjectOnly: true };
  }
  return undefined;
}

function enrichGameSkillManifest(
  manifest: CapabilityManifest,
): CapabilityManifest {
  const name = manifest.command.name;
  const lowerName = name.toLowerCase();
  const surfaces = new Set(manifest.surfaces);
  if (SETTINGS_COMMAND_NAME_SET.has(lowerName))
    surfaces.add("settingsCommands");
  if (GAME_PROJECT_SETTINGS_COMMAND_NAME_SET.has(lowerName)) {
    surfaces.add("projectSettingsCommands");
  }
  if (CLI_HELP_COMMAND_NAME_SET.has(lowerName)) surfaces.add("cliHelp");

  return {
    ...manifest,
    kind:
      name.endsWith("-mode-start") || name.endsWith("-mode-end")
        ? "mode"
        : manifest.kind,
    requiredSettings: requiredSettingsForCommand(name),
    resources: resourcesForCommand(name),
    rollback: rollbackForCommand(name),
    surfaces: orderedSurfaces(surfaces),
    gating: gatingForCommand(name),
  };
}

function genericShortcutManifest(
  command: GameSkillCommand,
): CapabilityManifest {
  return {
    id: command.name.replace(/^\//, ""),
    version: "1.0.0",
    kind: "command",
    category: "generic",
    command,
    triggers: {
      slash: [command.name],
      aliases: [],
    },
    inputs: {
      description:
        command.text["zh-CN"] ?? command.text["en-US"] ?? command.name,
    },
    outputs: {
      description:
        command.detail["zh-CN"] ?? command.detail["en-US"] ?? command.name,
    },
    requiredSettings: [],
    resources: [],
    verification: "按命令语义完成当前请求。",
    rollback: "无持久状态变更；重新输入原始请求即可。",
    surfaces: ["slashMenu"],
  };
}

export const GAME_SKILL_CAPABILITY_MANIFESTS: CapabilityManifest[] =
  GAME_SKILLS.map((skill) =>
    enrichGameSkillManifest(skill.toManifest()),
  ).filter((manifest) => commandEnabled(manifest.command.name));

export const GENERIC_PROMPT_SHORTCUT_MANIFESTS: CapabilityManifest[] =
  GENERIC_PROMPT_SHORTCUTS.map(genericShortcutManifest);

export const APP_CAPABILITY_MANIFESTS: CapabilityManifest[] = [
  ...GAME_SKILL_CAPABILITY_MANIFESTS,
  ...GENERIC_PROMPT_SHORTCUT_MANIFESTS,
];

const MANIFEST_BY_COMMAND_NAME = new Map(
  APP_CAPABILITY_MANIFESTS.map((manifest) => [
    manifest.command.name.toLowerCase(),
    manifest,
  ]),
);

function manifestByCommandName(name: string): CapabilityManifest {
  const manifest = MANIFEST_BY_COMMAND_NAME.get(name.toLowerCase());
  if (!manifest) throw new Error(`Missing capability manifest for ${name}`);
  return manifest;
}

function manifestsForOrderedNames(
  names: readonly string[],
): CapabilityManifest[] {
  return names.map(manifestByCommandName);
}

export function capabilityManifestByCommandName(
  name: string,
): CapabilityManifest | null {
  return MANIFEST_BY_COMMAND_NAME.get(name.trim().toLowerCase()) ?? null;
}

export function capabilityManifestsForSurface(
  surface: CapabilitySurface,
): CapabilityManifest[] {
  if (surface === "settingsCommands") {
    return manifestsForOrderedNames(ENABLED_SETTINGS_COMMAND_NAMES);
  }
  if (surface === "projectSettingsCommands") {
    return manifestsForOrderedNames(GAME_PROJECT_SETTINGS_COMMAND_NAMES);
  }
  if (surface === "cliHelp") {
    return manifestsForOrderedNames(ENABLED_CLI_HELP_COMMAND_NAMES);
  }
  return APP_CAPABILITY_MANIFESTS.filter((manifest) =>
    manifest.surfaces.includes(surface),
  );
}

export const PROJECT_COMMAND_NAMES: readonly string[] =
  ENABLED_SETTINGS_COMMAND_NAMES;

export const GAME_PROJECT_COMMAND_NAMES: readonly string[] =
  GAME_PROJECT_SETTINGS_COMMAND_NAMES;

export const CLI_HELP_CAPABILITY_MANIFESTS: CapabilityManifest[] =
  capabilityManifestsForSurface("cliHelp");
