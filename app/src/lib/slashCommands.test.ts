import { describe, expect, it } from "vitest";
import {
  GAME_PROJECT_COMMAND_NAMES,
  GAME_SKILL_STATIC_ENTRIES,
  PROJECT_COMMAND_NAMES,
  STATIC_SLASH_ENTRIES,
  buildGameSkillSuggestions,
  buildSlashSuggestions,
  isGameProjectCommandName,
  isProjectCommandName,
  slashEntrySourceAdapter,
  slashText,
  withAppOnlyStaticEntries,
} from "./slashCommands";
import type { SlashCatalogEntry } from "./tauri";

const catalogEntry = (over: Partial<SlashCatalogEntry>): SlashCatalogEntry => ({
  id: "command:claude-code:/status",
  kind: "command",
  name: "/status",
  label: { "en-US": "Status", "zh-CN": "状态" },
  detail: { "en-US": "Show status", "zh-CN": "显示状态" },
  insertText: { "en-US": "/status", "zh-CN": "/status" },
  source: "claude-code",
  sourceAdapter: "claude-code",
  ...over,
});

describe("slashText", () => {
  it("prefers the requested locale, then en-US, then zh-CN", () => {
    expect(slashText({ "zh-CN": "中", "en-US": "en" }, "zh-CN")).toBe("中");
    expect(slashText({ "zh-CN": "中", "en-US": "en" }, "fr-FR")).toBe("en");
    expect(slashText({ "zh-CN": "中" }, "fr-FR")).toBe("中");
    expect(slashText({}, "en-US")).toBe("");
  });
});

describe("slashEntrySourceAdapter", () => {
  it("normalizes explicit adapters and claude/anthropic aliases", () => {
    expect(
      slashEntrySourceAdapter(catalogEntry({ sourceAdapter: "anthropic" })),
    ).toBe("claude-code");
    expect(
      slashEntrySourceAdapter(catalogEntry({ sourceAdapter: "codex" })),
    ).toBe("codex");
  });

  it("falls back to the source path when no adapter is given", () => {
    expect(
      slashEntrySourceAdapter(
        catalogEntry({
          sourceAdapter: null,
          source: "/home/u/.gemini/commands/foo.toml",
        }),
      ),
    ).toBe("gemini");
  });

  it("recovers the adapter from the entry id prefix", () => {
    expect(
      slashEntrySourceAdapter(
        catalogEntry({
          id: "skill:codex:/deploy",
          sourceAdapter: null,
          source: "",
        }),
      ),
    ).toBe("codex");
  });
});

describe("withAppOnlyStaticEntries", () => {
  it("appends generic prompt shortcuts the catalog does not enumerate", () => {
    const merged = withAppOnlyStaticEntries([catalogEntry({})]);
    const names = merged.map((entry) => entry.name);
    expect(names).toContain("/status");
    // Generic prompt shortcuts are folded back into the `/` menu.
    expect(names).toContain("/plan");
    expect(names).toContain("/review");
    // GameSkills also fold into the global `/` menu; `#游戏Skill` is a faster
    // narrower surface, not the only surface.
    expect(names).toContain("/image-mode-start");
    expect(names).toContain("/image-to-game");
    expect(names).toContain("/gdd-mode-start");
    expect(names).toContain("/gdd-mode-end");
    expect(names).toContain("/game-template-skill");
    expect(names).toContain("/game-debug-skill");
    expect(names).toContain("/game-verify-report");
    expect(names).toContain("/video-to-frames");
    expect(names).toContain("/sprite-mode-start");
    expect(names).toContain("/blueprint-mode-start");
    expect(names).toContain("/metahuman-mode-start");
    expect(names).toContain("/screenshot");
    expect(names).not.toContain("/studio");
    expect(names).not.toContain("/deep-research");
  });

  it("filters removed app slash commands even when an external catalog reports them", () => {
    const merged = withAppOnlyStaticEntries([
      catalogEntry({
        id: "skill:claude:/studio",
        kind: "skill",
        name: "/studio",
        source: ".claude/skills/studio/SKILL.md",
        sourceAdapter: "claude-code",
      }),
      catalogEntry({
        id: "skill:claude:/deep-research",
        kind: "skill",
        name: "/deep-research",
        source: ".claude/skills/deep-research/SKILL.md",
        sourceAdapter: "claude-code",
      }),
      catalogEntry({
        id: "command:claude-code:/status",
        name: "/status",
        source: "claude-code",
        sourceAdapter: "claude-code",
      }),
    ]);
    const names = merged.map((entry) => entry.name);
    expect(names).toContain("/status");
    expect(names).not.toContain("/studio");
    expect(names).not.toContain("/deep-research");
  });

  it("does not duplicate an entry already present in the catalog", () => {
    const merged = withAppOnlyStaticEntries([
      catalogEntry({ id: "command:app:/help", name: "/help", source: "app" }),
    ]);
    expect(merged.filter((entry) => entry.name === "/help")).toHaveLength(1);
  });

  it("keeps app manifests even when an external CLI has the same slash name", () => {
    const merged = withAppOnlyStaticEntries([
      catalogEntry({
        id: "command:codex:/help",
        name: "/help",
        source: "codex",
        sourceAdapter: "codex",
      }),
    ]);
    const helpEntries = merged.filter((entry) => entry.name === "/help");
    expect(helpEntries).toHaveLength(2);
    expect(helpEntries.map((entry) => slashEntrySourceAdapter(entry))).toEqual([
      "codex",
      "app",
    ]);
  });
});

describe("buildSlashSuggestions", () => {
  it("falls back to static entries when the catalog is empty", () => {
    const suggestions = buildSlashSuggestions([], "en-US");
    expect(suggestions).toHaveLength(STATIC_SLASH_ENTRIES.length);
    expect(suggestions.every((s) => s.sourceAdapter === "app")).toBe(true);
  });

  it("carries an adapter and lowercased searchText for each suggestion", () => {
    const [suggestion] = buildSlashSuggestions([catalogEntry({})], "en-US");
    expect(suggestion.sourceAdapter).toBe("claude-code");
    expect(suggestion.searchText).toBe(suggestion.searchText.toLowerCase());
    expect(suggestion.searchText).toContain("/status");
  });
});

describe("project command allowlist", () => {
  it("matches names case-insensitively and trims whitespace", () => {
    expect(isProjectCommandName("/studio")).toBe(false);
    expect(isProjectCommandName("  /Deep-Research ")).toBe(false);
    expect(isProjectCommandName("  /IMAGE-TO-GAME ")).toBe(true);
    expect(isProjectCommandName("  /VIDEO-TO-FRAMES ")).toBe(true);
    expect(isGameProjectCommandName("/sprite-mode-start")).toBe(true);
    expect(isGameProjectCommandName("/blueprint-mode-start")).toBe(true);
    expect(isGameProjectCommandName("/metahuman-mode-start")).toBe(true);
    expect(isGameProjectCommandName("  /METAHUMAN-MODE-END ")).toBe(true);
    expect(isGameProjectCommandName("  /BLUEPRINT-MODE-END ")).toBe(true);
    expect(isGameProjectCommandName("  /SPRITE ")).toBe(true);
    expect(isGameProjectCommandName("  /IMAGE-TO-GAME ")).toBe(true);
    expect(isGameProjectCommandName("  /GDD-MODE-START ")).toBe(true);
    expect(isGameProjectCommandName("  /GDD-MODE-END ")).toBe(true);
    expect(isGameProjectCommandName("  /GAME-TEMPLATE-SKILL ")).toBe(true);
    expect(isGameProjectCommandName("  /GAME-DEBUG-SKILL ")).toBe(true);
    expect(isGameProjectCommandName("  /GAME-VERIFY-REPORT ")).toBe(true);
    expect(isProjectCommandName("/sprite-mode-start")).toBe(false);
    expect(isGameProjectCommandName("/game")).toBe(true);
    expect(isGameProjectCommandName("  /MESH-MODE-START ")).toBe(true);
    expect(isGameProjectCommandName("  /UI-MODE-START ")).toBe(true);
    expect(isProjectCommandName("/game")).toBe(false);
    expect(isProjectCommandName("/help")).toBe(false);
    expect(isProjectCommandName("/plan")).toBe(false);
  });

  it("every allowlisted command has a game-skill static entry to render", () => {
    const staticNames = new Set(
      GAME_SKILL_STATIC_ENTRIES.map((entry) => entry.name.toLowerCase()),
    );
    for (const name of PROJECT_COMMAND_NAMES) {
      expect(staticNames.has(name.toLowerCase())).toBe(true);
    }
    for (const name of GAME_PROJECT_COMMAND_NAMES) {
      expect(staticNames.has(name.toLowerCase())).toBe(true);
    }
  });

  it("excludes generic prompt shortcuts from the project list", () => {
    const projectOnly = buildGameSkillSuggestions("en-US").filter((item) =>
      isProjectCommandName(item.name),
    );
    const names = projectOnly.map((item) => item.name);
    expect(names).not.toContain("/studio");
    expect(names).not.toContain("/deep-research");
    expect(names).toContain("/image-to-game");
    expect(names).toContain("/video-to-frames");
    expect(names).not.toContain("/sprite");
    expect(names).not.toContain("/sprite-mode-start");
    expect(names).not.toContain("/sprite-mode-end");
    expect(names).not.toContain("/game");
    expect(names).not.toContain("/help");
    expect(names).not.toContain("/review");
  });

  it("keeps the video-to-frames command wired to the local Skill prompt", () => {
    const command = buildGameSkillSuggestions("zh-CN").find(
      (item) => item.name === "/video-to-frames",
    );
    expect(command?.label).toBe("视频转动画帧");
    expect(command?.detail).toContain("video-to-animation-frames Skill");
    expect(command?.insertText).toContain("video-to-animation-frames");
    expect(command?.insertText).toContain(
      ".codex/skills/video-to-animation-frames/scripts/video_to_animation_frames.py",
    );
  });

  it("keeps OpenGame-inspired game workflow commands browser-first", () => {
    const suggestions = buildGameSkillSuggestions("zh-CN");
    for (const name of [
      "/game-template-skill",
      "/game-debug-skill",
      "/game-verify-report",
    ]) {
      const command = suggestions.find((item) => item.name === name);
      expect(command?.insertText).toContain("浏览器");
      expect(command?.insertText).toContain("不要生成 workflow 蓝图或 IRGraph");
    }
    expect(
      suggestions.find((item) => item.name === "/game-verify-report")
        ?.insertText,
    ).toContain("浏览器检查是硬验收");
    expect(
      suggestions.find((item) => item.name === "/game-template-skill")
        ?.insertText,
    ).toContain("30 个主流模板");
    expect(
      suggestions.find((item) => item.name === "/game-template-skill")
        ?.insertText,
    ).toContain("fps");
  });

  it("groups sprite, mesh, and ui commands under the game project list", () => {
    const gameOnly = buildGameSkillSuggestions("en-US").filter((item) =>
      isGameProjectCommandName(item.name),
    );
    const names = gameOnly.map((item) => item.name);
    expect(names).toContain("/game");
    expect(names).toContain("/image-to-game");
    expect(names).toContain("/gdd-mode-start");
    expect(names).toContain("/gdd-mode-end");
    expect(names).toContain("/game-template-skill");
    expect(names).toContain("/game-debug-skill");
    expect(names).toContain("/game-verify-report");
    expect(names).toContain("/mesh-mode-start");
    expect(names).toContain("/mesh-search");
    expect(names).toContain("/sprite");
    expect(names).toContain("/sprite-mode-start");
    expect(names).toContain("/sprite-mode-end");
    expect(names).toContain("/blueprint-mode-start");
    expect(names).toContain("/blueprint-mode-end");
    expect(names).toContain("/metahuman-mode-start");
    expect(names).toContain("/metahuman-mode-end");
    expect(names).toContain("/ui-mode-start");
    expect(names).toContain("/ui-mode-end");
  });
});
