import { describe, expect, it } from "vitest";
import {
  APP_CAPABILITY_MANIFESTS,
  CLI_HELP_CAPABILITY_MANIFESTS,
  GAME_PROJECT_COMMAND_NAMES,
  GAME_SKILL_CAPABILITY_MANIFESTS,
  PROJECT_COMMAND_NAMES,
  capabilityManifestsForSurface,
} from "./capabilityCatalog";

describe("capability catalog", () => {
  it("has one manifest per app command", () => {
    expect(APP_CAPABILITY_MANIFESTS.length).toBeGreaterThan(0);
    const names = APP_CAPABILITY_MANIFESTS.map((manifest) =>
      manifest.command.name.toLowerCase(),
    );
    expect(new Set(names).size).toBe(names.length);

    for (const manifest of APP_CAPABILITY_MANIFESTS) {
      expect(manifest.id).toBeTruthy();
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(manifest.triggers.slash).toContain(manifest.command.name);
      expect(manifest.inputs.description).toBeTruthy();
      expect(manifest.outputs.description).toBeTruthy();
      expect(manifest.verification).toBeTruthy();
      expect(manifest.rollback).toBeTruthy();
    }
  });

  it("keeps GameSkill manifests separate from generic shortcuts", () => {
    const gameSkillNames = GAME_SKILL_CAPABILITY_MANIFESTS.map(
      (manifest) => manifest.command.name,
    );
    expect(gameSkillNames).toHaveLength(38);
    expect(gameSkillNames).toContain("/game");
    expect(gameSkillNames).toContain("/gdd-mode-start");
    expect(gameSkillNames).toContain("/gdd-mode-end");
    expect(gameSkillNames).toContain("/game-template-skill");
    expect(gameSkillNames).toContain("/game-debug-skill");
    expect(gameSkillNames).toContain("/game-verify-report");
    expect(gameSkillNames).not.toContain("/deep-research");
    expect(gameSkillNames).not.toContain("/studio");
    expect(gameSkillNames).not.toContain("/help");
  });

  it("derives settings command allowlists from manifests", () => {
    const projectNames = capabilityManifestsForSurface("settingsCommands").map(
      (manifest) => manifest.command.name,
    );
    const gameProjectNames = capabilityManifestsForSurface(
      "projectSettingsCommands",
    ).map((manifest) => manifest.command.name);

    expect(projectNames).toEqual([...PROJECT_COMMAND_NAMES]);
    expect(gameProjectNames).toEqual([...GAME_PROJECT_COMMAND_NAMES]);
  });

  it("exposes CLI help capabilities from the same manifest layer", () => {
    expect(
      CLI_HELP_CAPABILITY_MANIFESTS.map((manifest) => manifest.command.name),
    ).toEqual([]);
  });
});
