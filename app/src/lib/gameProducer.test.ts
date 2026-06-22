import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_EXPERT_SETTINGS } from "./gameExperts";
import {
  PRODUCER_PIPELINES,
  PRODUCER_MAX_REWORK,
  buildPlan,
  buildProducerPrompt,
  readyTasks,
  selectPipeline,
  shouldUseProducer,
  type ProducerPlan,
} from "./gameProducer";

function enabledSettings() {
  return { ...DEFAULT_GAME_EXPERT_SETTINGS, enabled: true };
}

describe("game producer lens planning", () => {
  it('selects the full-game pipeline for a "design a 3D shooter" request', () => {
    const tpl = selectPipeline("给我设计一个3D飞机大战游戏");
    expect(tpl.id).toBe("full-game");
  });

  it("selects the prototype pipeline when only validating a mechanic", () => {
    const tpl = selectPipeline("快速做个原型验证这个玩法手感");
    expect(tpl.id).toBe("prototype-only");
  });

  it("selects the asset pipeline for pure art/audio asset work", () => {
    const tpl = selectPipeline("帮我产出一批原画和配套音效资产");
    expect(tpl.id).toBe("asset-pipeline");
  });

  it("builds a task DAG where downstream tasks depend on upstream stage tasks", () => {
    const plan = buildPlan("设计一个完整的3D飞机大战游戏");
    expect(plan.template.id).toBe("full-game");

    const concept = plan.tasks.filter((t) => t.stage === "concept");
    const art = plan.tasks.filter((t) => t.stage === "art");
    expect(concept.length).toBeGreaterThan(0);
    expect(art.length).toBeGreaterThan(0);

    // concept has no deps; art depends on design tasks.
    for (const t of concept) expect(t.dependsOn).toHaveLength(0);
    const designIds = plan.tasks
      .filter((t) => t.stage === "design")
      .map((t) => t.id);
    for (const t of art)
      expect(t.dependsOn.some((d) => designIds.includes(d))).toBe(true);
  });

  it("every task gets objective acceptance criteria and a known owner", () => {
    const plan = buildPlan("设计一个完整的3D飞机大战游戏");
    for (const t of plan.tasks) {
      expect(t.acceptance.length).toBeGreaterThan(0);
      expect(t.ownerExpertId).toBeTruthy();
    }
  });

  it("readyTasks returns only dependency-free tasks first, then unlocks downstream", () => {
    const plan = buildPlan("设计一个完整的3D飞机大战游戏");
    const first = readyTasks(plan);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((t) => t.stage === "concept")).toBe(true);

    // Mark all concept tasks done; prototype should unlock next.
    for (const t of plan.tasks) if (t.stage === "concept") t.status = "done";
    const second = readyTasks(plan);
    expect(second.every((t) => t.stage === "prototype")).toBe(true);
  });

  it("art and audio can run in parallel (both depend only on design)", () => {
    const plan = buildPlan("设计一个完整的3D飞机大战游戏");
    for (const t of plan.tasks)
      if (["concept", "prototype", "design"].includes(t.stage))
        t.status = "done";
    const ready = readyTasks(plan);
    const stages = new Set(ready.map((t) => t.stage));
    expect(stages.has("art")).toBe(true);
    expect(stages.has("audio")).toBe(true);
  });

  it("producer prompt positions producer as a planning lens and lists stages", () => {
    const prompt = buildProducerPrompt(
      "设计一个3D飞机大战游戏",
      enabledSettings(),
      { image: true, music: true, threeD: true },
    );
    expect(prompt).toContain("游戏制作人视角");
    expect(prompt).toContain("单模型融合专家约束");
    expect(prompt).toContain("不要声称已经并行执行或已分派给其他 agent");
    expect(prompt).toContain("/image");
    expect(prompt).toContain("/mesh-mode-start");
    expect(prompt).toContain(String(PRODUCER_MAX_REWORK));
  });

  it("producer prompt is empty when game experts are disabled", () => {
    const prompt = buildProducerPrompt("设计一个3D飞机大战游戏", {
      ...DEFAULT_GAME_EXPERT_SETTINGS,
      enabled: false,
    });
    expect(prompt).toBe("");
  });

  it("force bypasses the disabled gate (explicit /game invocation)", () => {
    const prompt = buildProducerPrompt(
      "设计一个3D飞机大战游戏",
      { ...DEFAULT_GAME_EXPERT_SETTINGS, enabled: false },
      { image: true, music: true, threeD: true },
      { force: true },
    );
    expect(prompt).toContain("【游戏制作人视角】");
  });

  it("onPlanReady hook can rewrite the plan", () => {
    const plan: ProducerPlan = buildPlan("设计一个完整的3D飞机大战游戏");
    const trimmed: ProducerPlan = {
      ...plan,
      tasks: plan.tasks.filter((t) => t.stage !== "content"),
    };
    const hook = (p: ProducerPlan) =>
      p.tasks.some((t) => t.stage === "content") ? trimmed : undefined;
    const result = hook(plan) ?? plan;
    expect(result.tasks.some((t) => t.stage === "content")).toBe(false);
  });

  it("exposes three固化 pipeline templates", () => {
    expect(PRODUCER_PIPELINES).toHaveLength(3);
    const ids = PRODUCER_PIPELINES.map((p) => p.id);
    expect(ids).toContain("full-game");
    expect(ids).toContain("prototype-only");
    expect(ids).toContain("asset-pipeline");
  });

  it("shouldUseProducer triggers on full-game build intent", () => {
    expect(shouldUseProducer("给我设计一个3D飞机大战游戏")).toBe(true);
    expect(shouldUseProducer("开发一款 roguelike 游戏")).toBe(true);
  });

  it("shouldUseProducer triggers when multiple production domains appear", () => {
    expect(shouldUseProducer("需要玩法设计和配套美术与音效")).toBe(true);
  });

  it("shouldUseProducer stays off for narrow single-topic questions", () => {
    expect(shouldUseProducer("帮我看下这段 shader 为什么闪烁")).toBe(false);
    expect(shouldUseProducer("解释一下四元数插值")).toBe(false);
  });
});
