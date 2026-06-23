import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_EXPERT_SETTINGS,
  normalizeGameExpertSettings,
  parseGameExpertCommand,
} from "./gameExperts";
import {
  buildGameOrgTree,
  collectGameOrgSkillBindings,
  findGameOrgNode,
  flattenGameOrgNodes,
  planGameOrgTask,
  recommendGameOrgSkills,
  routeGameOrgAssetRequest,
  type GameOrgNodeDefinition,
} from "./gameOrg";

function gameOrgSettings() {
  return normalizeGameExpertSettings({
    ...DEFAULT_GAME_EXPERT_SETTINGS,
    enabled: true,
  });
}

describe("game organization tree", () => {
  it("places producer at the root and exposes director branches", () => {
    const tree = buildGameOrgTree(gameOrgSettings(), "zh-CN");
    const labels = flattenGameOrgNodes(tree).map((node) => node.label);

    expect(tree.label).toBe("制作人");
    expect(tree.icon).toBe("producer");
    expect(labels).toContain("技术总监");
    expect(labels).toContain("美术总监");
    expect(labels).toContain("QA 负责人");
  });

  it("builds executable skill commands that route through game expert slash parsing", () => {
    const settings = gameOrgSettings();
    const tree = buildGameOrgTree(settings, "zh-CN");
    const technicalDirector = findGameOrgNode(tree, "technical-director");
    const featureSkill = technicalDirector?.skills.find(
      (skill) => skill.id === "feature-development",
    );
    const ueReviewSkill = technicalDirector?.skills.find(
      (skill) => skill.id === "ue-architecture-review",
    );

    expect(technicalDirector?.icon).toBe("tech");
    expect(featureSkill?.commandText).toContain("/technical-director ");
    expect(featureSkill?.commandText).toContain("Skill 标准六项");
    expect(featureSkill?.protocol.executionSteps.length).toBeGreaterThan(0);
    expect(ueReviewSkill?.label).toBe("UE 架构严审");
    expect(ueReviewSkill?.commandText).toContain("Unreal Gameplay Framework");
    expect(ueReviewSkill?.commandText).toContain("go/no-go");
    expect(ueReviewSkill?.protocol.acceptanceCriteria).toContain(
      "默认不能通过",
    );
    const parsed = parseGameExpertCommand(
      featureSkill?.commandText ?? "",
      settings,
    );
    expect(parsed?.expertIds).toEqual(["technical-director"]);
    expect(parsed?.task).toContain("发起功能开发");
  });

  it("localizes built-in organization labels and skills for English UI", () => {
    const tree = buildGameOrgTree(gameOrgSettings(), "en-US");
    const technicalDirector = findGameOrgNode(tree, "technical-director");
    const featureSkill = technicalDirector?.skills.find(
      (skill) => skill.id === "feature-development",
    );
    const ueReviewSkill = technicalDirector?.skills.find(
      (skill) => skill.id === "ue-architecture-review",
    );

    expect(tree.label).toBe("Producer");
    expect(technicalDirector?.label).toBe("Technical Director");
    expect(technicalDirector?.summary).toContain("engineering architecture");
    expect(featureSkill?.label).toBe("Start Feature Development");
    expect(featureSkill?.commandText).toContain("/technical-director ");
    expect(featureSkill?.commandText).toContain("Start feature development");
    expect(ueReviewSkill?.label).toBe("Strict UE Architecture Review");
    expect(ueReviewSkill?.commandText).toContain("server authority");
  });

  it("keeps user-customized organization text unchanged when locale changes", () => {
    const definition: GameOrgNodeDefinition = {
      id: "technical-director",
      label: "Tech Owner",
      icon: "tech",
      summary: "Custom summary",
      role: "Custom role",
      expertIds: ["technical-director"],
      skills: [
        {
          id: "feature-development",
          label: "Custom feature kickoff",
          summary: "Custom skill summary",
          prompt: "Custom prompt.",
        },
      ],
    };

    const tree = buildGameOrgTree(gameOrgSettings(), "en-US", definition);

    expect(tree.label).toBe("Tech Owner");
    expect(tree.summary).toBe("Custom summary");
    expect(tree.role).toBe("Custom role");
    expect(tree.skills[0]?.label).toBe("Custom feature kickoff");
    expect(tree.skills[0]?.commandText).toContain("Custom prompt.");
  });

  it("keeps art style changes attached to the art director branch", () => {
    const tree = buildGameOrgTree(gameOrgSettings(), "zh-CN");
    const artDirector = findGameOrgNode(tree, "art-director");

    expect(artDirector?.icon).toBe("art");
    expect(artDirector?.allowedCapabilities).toEqual(
      expect.arrayContaining(["image", "sprite", "mesh", "ui"]),
    );
    expect(
      artDirector?.skills.some((skill) => skill.id === "style-change"),
    ).toBe(true);
    expect(
      artDirector?.skills.find((skill) => skill.id === "style-change")
        ?.commandText,
    ).toContain("资产请求路由协议");
    expect(artDirector?.children.map((child) => child.label)).toEqual(
      expect.arrayContaining([
        "2D 美术 / 概念",
        "角色美术",
        "场景美术",
        "UI 设计",
        "VFX / Shader",
      ]),
    );
  });

  it("builds the org tree from caller-provided editable definitions", () => {
    const definition: GameOrgNodeDefinition = {
      id: "custom-root",
      label: "自定义负责人",
      icon: "team",
      summary: "完全自定义的组织根节点。",
      role: "按用户保存的配置工作。",
      profile: {
        position: "负责自定义组织配置。",
        responsibilities: ["维护岗位库", "维护 Skill 绑定"],
        scenarios: ["需要定制团队结构时"],
        deliverables: ["岗位配置方案"],
        collaborators: ["制作人", "技术总监"],
      },
      skills: [],
      children: [
        {
          id: "custom-role",
          label: "自定义岗位",
          icon: "tools",
          allowedCapabilities: ["image", "sprite"],
          skills: [
            {
              id: "custom-skill",
              label: "自定义 Skill",
              summary: "用户配置的 Skill。",
              prompt: "执行用户配置的 Skill。",
              protocol: {
                triggerConditions: "用户需要自定义处理。",
                inputs: "需求描述。",
                executionSteps: ["确认需求", "输出方案"],
                toolsAndResources: "当前工作区。",
                outputs: "处理方案。",
                acceptanceCriteria: "方案可执行。",
              },
            },
          ],
        },
      ],
    };

    const tree = buildGameOrgTree(gameOrgSettings(), "zh-CN", definition);

    expect(tree.label).toBe("自定义负责人");
    expect(tree.skills).toEqual([]);
    expect(tree.profile.position).toBe("负责自定义组织配置。");
    expect(tree.profile.responsibilities).toEqual([
      "维护岗位库",
      "维护 Skill 绑定",
    ]);
    expect(tree.profile.scenarios).toEqual(["需要定制团队结构时"]);
    expect(tree.profile.deliverables).toEqual(["岗位配置方案"]);
    expect(tree.profile.collaborators).toEqual(["制作人", "技术总监"]);
    expect(findGameOrgNode(tree, "custom-role")?.skills[0]?.label).toBe(
      "自定义 Skill",
    );
    expect(
      findGameOrgNode(tree, "custom-role")?.skills[0]?.commandText,
    ).toContain("/游戏专家 执行用户配置的 Skill。");
    expect(
      findGameOrgNode(tree, "custom-role")?.skills[0]?.commandText,
    ).toContain("触发条件：用户需要自定义处理。");
    expect(
      findGameOrgNode(tree, "custom-role")?.skills[0]?.allowedCapabilities,
    ).toEqual(["image", "sprite"]);
  });

  it("fills role profile defaults for legacy organization nodes", () => {
    const definition: GameOrgNodeDefinition = {
      id: "legacy-role",
      label: "旧岗位",
      summary: "旧岗位摘要。",
      role: "旧岗位职责。",
      expertIds: ["technical-director"],
      skills: [],
    };

    const tree = buildGameOrgTree(gameOrgSettings(), "zh-CN", definition);

    expect(tree.profile.position).toBe("旧岗位摘要。");
    expect(tree.profile.responsibilities).toEqual(["旧岗位职责。"]);
    expect(tree.profile.scenarios[0]).toContain("旧岗位");
    expect(tree.profile.deliverables[0]).toContain("建议");
    expect(tree.profile.collaborators).toContain("技术总监");
  });

  it("collects role-skill bindings and reverse collaborator references", () => {
    const tree = buildGameOrgTree(gameOrgSettings(), "zh-CN");
    const bindings = collectGameOrgSkillBindings(tree, "technical-director");

    expect(bindings.own.map((binding) => binding.skillId)).toContain(
      "feature-development",
    );
    expect(
      bindings.own.find((binding) => binding.skillId === "feature-development")
        ?.collaboratorLabels,
    ).toEqual(expect.arrayContaining(["玩法程序", "技术美术"]));
    const technicalArtistBindings = collectGameOrgSkillBindings(
      tree,
      "technical-artist",
    );
    expect(
      technicalArtistBindings.own.find(
        (binding) => binding.skillId === "art-pipeline-setup",
      )?.allowedCapabilities,
    ).toEqual(expect.arrayContaining(["mesh", "sprite", "image"]));
    expect(bindings.incoming.length).toBeGreaterThan(0);
    expect(bindings.incoming.map((binding) => binding.roleId)).toContain(
      "producer",
    );
  });

  it("recommends organization skills for natural-language game tasks", () => {
    const tree = buildGameOrgTree(gameOrgSettings(), "zh-CN");
    const combatMatches = recommendGameOrgSkills(
      tree,
      "设计一个 2D 横版角色攻击系统",
      { limit: 5 },
    );
    const perfMatches = recommendGameOrgSkills(
      tree,
      "排查移动端战斗场景卡顿和帧率问题",
      {
        limit: 5,
      },
    );

    expect(combatMatches.map((match) => match.skillId)).toEqual(
      expect.arrayContaining(["design-mechanic"]),
    );
    expect(combatMatches[0]?.score).toBeGreaterThan(0);
    expect(perfMatches.map((match) => match.skillId)).toEqual(
      expect.arrayContaining(["client-perf-pass", "perf-profiling"]),
    );
    expect(perfMatches[0]?.matchedTerms.length).toBeGreaterThan(0);
  });

  it("recommends the strict UE architecture review for Unreal architecture audits", () => {
    const tree = buildGameOrgTree(gameOrgSettings(), "zh-CN");
    const matches = recommendGameOrgSkills(
      tree,
      "UE5 架构审核：检查 GAS、网络复制、模块依赖和 Blueprint 分工",
      { limit: 5 },
    );

    expect(matches.map((match) => match.skillId)).toContain(
      "ue-architecture-review",
    );
  });

  it("recommends functional art skills for concrete asset generation requests", () => {
    const tree = buildGameOrgTree(gameOrgSettings(), "zh-CN");
    const matches = recommendGameOrgSkills(
      tree,
      "生成角色四方向 idle 和 run spritesheet",
      { limit: 5 },
    );

    expect(matches.map((match) => match.roleId)).toEqual(
      expect.arrayContaining(["character-art"]),
    );
    expect(
      matches.some((match) => match.allowedCapabilities.includes("sprite")),
    ).toBe(true);
  });

  it("routes a role asset request to the matching game asset capability", () => {
    const tree = buildGameOrgTree(gameOrgSettings(), "zh-CN");
    const route = routeGameOrgAssetRequest(
      tree,
      "character-art",
      "生成角色四方向 idle 和 run spritesheet",
    );

    expect(route?.capability.id).toBe("sprite");
    expect(route?.commandText).toContain("/sprite");
    expect(route?.assetRequest).toContain("role: 角色美术");
  });

  it("plans multi-role lens suggestions from a game task", () => {
    const tree = buildGameOrgTree(gameOrgSettings(), "zh-CN");
    const plan = planGameOrgTask(tree, "设计一个 2D 横版角色攻击系统", {
      limit: 4,
      locale: "zh-CN",
    });

    expect(plan.query).toBe("设计一个 2D 横版角色攻击系统");
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    expect(plan.steps.length).toBeLessThanOrEqual(4);
    expect(
      new Set(plan.steps.map((step) => step.roleId)).size,
    ).toBeGreaterThanOrEqual(2);
    expect(plan.steps.map((step) => step.skillId)).toEqual(
      expect.arrayContaining(["design-mechanic"]),
    );
    expect(plan.steps[0]?.reason).toContain("命中");
    expect(plan.commandText).toContain("多视角参考建议");
    expect(plan.commandText).toContain("玩法策划 / 设计玩法机制");
    expect(plan.commandText).toContain("验收标准");
    expect(plan.documentText).toContain(
      "# 多视角参考建议：设计一个 2D 横版角色攻击系统",
    );
    expect(plan.documentText).toContain("## 视角");
    expect(plan.documentText).toContain("- 推荐理由：");
    expect(plan.documentText).toContain("- 产出物：");
    expect(plan.documentText).toContain("- 验收标准：");
    expect(plan.checklistText).toContain(
      "# 视角检查清单：设计一个 2D 横版角色攻击系统",
    );
    expect(plan.checklistText).toContain("- [ ] 视角");
    expect(plan.checklistText).toContain("  - 产出物：");
    expect(plan.checklistText).toContain("  - 验收：");
  });
});
