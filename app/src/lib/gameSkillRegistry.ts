// GameSkill registry: every UltraGameStudio-introduced slash command is authored
// from the GameSkill class hierarchy with its standard six-part protocol.
// `capabilityCatalog.ts` projects GAME_SKILLS into versioned manifests, and
// downstream surfaces consume those manifests.
//
// CONTRACT: Generic prompt shortcuts (/help, /plan, /diagnose, /review,
// /explain, /test) are NOT GameSkills and stay in capabilityCatalog.ts.
import { GameSkill, ModeStartSkill, ModeEndSkill } from "@/lib/gameSkill";
import { formatGameTemplateCatalogForPrompt } from "@/lib/gameTemplateProfiles";

const VIDEO_TO_FRAMES_TEXT = {
  "zh-CN":
    "执行视频转动画帧：使用本地 Skill `video-to-animation-frames` 处理我提供的视频、GIF 或屏幕录制文件。直接在当前工作区落地结果，不要生成 workflow 蓝图或 IRGraph。\n\n请按以下流程完成：\n1. 识别输入文件路径、目标用途和当前项目引擎；涉及游戏项目时根据工作区文件自动判断 Unity / Unreal / Godot / Cocos / Web，不要默认使用 Godot。\n2. 优先使用 Skill 自带脚本 `.codex/skills/video-to-animation-frames/scripts/video_to_animation_frames.py`；检查 ffmpeg/ffprobe 可用性，必要时说明缺失依赖。\n3. 输出 PNG 序列帧；如用户要求透明背景，按素材情况选择 chromakey 或 rembg；需要打包时生成 sprite-sheet.png 和 manifest.json。\n4. 将结果保存到清晰的输出目录，并汇报帧数、帧率、尺寸、透明处理方式、manifest 路径和引擎导入建议。\n5. 若输入信息缺失但可从当前上下文推断，则直接处理；只有缺少视频路径或关键目标无法判断时才询问。",
  "en-US":
    "Run video-to-animation-frames: use the local `video-to-animation-frames` Skill to process the video, GIF, or screen recording I provide. Write outputs directly into the current workspace; do not generate a workflow blueprint or IRGraph.\n\nFollow this process:\n1. Identify the input file path, target use case, and current project engine; for game projects infer Unity / Unreal / Godot / Cocos / Web from workspace files instead of defaulting to Godot.\n2. Prefer the Skill script `.codex/skills/video-to-animation-frames/scripts/video_to_animation_frames.py`; check ffmpeg/ffprobe availability and report missing dependencies when needed.\n3. Export PNG frame sequences; when transparency is requested, choose chromakey or rembg based on the asset; generate sprite-sheet.png and manifest.json when packing is needed.\n4. Save outputs to a clear output directory and report frame count, fps, size, transparency method, manifest path, and engine import guidance.\n5. If missing details can be inferred from context, proceed; ask only when the video path or critical target is unknown.",
};

const IMAGE_TO_GAME_TEXT = {
  "zh-CN":
    "执行图像驱动游戏开发分析：把我提供的参考图、截图、链接或画面描述当作需求规格，而不是只做审美点评。直接输出可执行的游戏开发方案，不要生成 workflow 蓝图或 IRGraph，除非我明确要求。\n\n请按以下结构分析：\n1. 画面规格：视角、类型、核心体验、目标平台、画面密度、UI/交互线索、风格关键词。\n2. 玩法推断：玩家目标、核心循环、输入方式、关卡/战斗/经济/叙事系统假设，并明确哪些是从画面推断、哪些需要验证。\n3. 引擎实现：优先按当前工作区检测/配置的项目引擎拆解；如果未识别，则根据项目文件、路径、上下文和用户描述自动判读 Unity / Unreal / Godot / Cocos / Web 等引擎，不要默认使用 Godot。列出对应引擎的场景/对象层级、TileMap/地形/关卡资源、相机、碰撞、动画、状态机、数据结构和关键脚本/蓝图/组件职责。\n4. 素材清单：把画面拆成可生成/可采购/需手工处理的资产，包括角色、动作、tileset、背景层、特效、UI 图标、音效/BGM、字体和调色板。\n5. 生成提示词：给出概念图、角色 sprite sheet、tileset、UI、图标、特效、音乐/音效的提示词；要求透明背景、尺寸、帧数、朝向、一致性和负面约束。\n6. 落地计划：按 MVP、可玩原型、内容扩展三个阶段给出任务清单、验收标准和主要风险。特别指出 AI 生成动作帧、肢体一致性、可用碰撞形状、版权和人工修图风险。",
  "en-US":
    "Run an image-driven game development analysis: treat my reference image, screenshot, link, or scene description as the requirements spec, not just an aesthetic reference. Return an executable game development plan directly; do not generate a workflow blueprint or IRGraph unless I explicitly ask.\n\nUse this structure:\n1. Screen spec: camera/view, genre, core experience, target platform, scene density, UI/interaction clues, and style keywords.\n2. Gameplay inference: player goals, core loop, input model, level/combat/economy/narrative assumptions, separating inferred points from points that need validation.\n3. Engine implementation: prioritize the current workspace detected/configured project engine. If it is unrecognized, infer the engine from project files, paths, context, and the user request across Unity / Unreal / Godot / Cocos / Web instead of defaulting to Godot. List the matching engine's scene/object hierarchy, TileMap/terrain/level assets, camera, collision, animation, state machines, data structures, and key script/blueprint/component responsibilities.\n4. Asset list: break the screen into assets to generate, buy, or hand-fix, including characters, actions, tilesets, background layers, VFX, UI icons, SFX/BGM, fonts, and palette.\n5. Generation prompts: provide prompts for concept art, character sprite sheets, tilesets, UI, icons, VFX, music/SFX, including transparency, dimensions, frame count, directions, consistency, and negative constraints.\n6. Delivery plan: provide MVP, playable prototype, and content expansion phases with tasks, acceptance criteria, and main risks. Call out AI animation-frame consistency, limbs, collision usability, copyright, and manual cleanup risks.",
};

const GAME_TEMPLATE_SKILL_TEXT = {
  "zh-CN":
    `执行游戏模板能力选择：把当前需求、GDD、项目文件和已存在代码作为输入，先从 Template Profile 注册表选择最小可行的游戏模板与能力边界，再决定是否落地。不要生成 workflow 蓝图或 IRGraph。\n\n${formatGameTemplateCatalogForPrompt("zh-CN")}\n\n请按以下流程完成：\n1. 检测当前项目引擎：根据 .uproject、Packages/manifest.json + ProjectSettings、project.godot、project.json/assets、package.json 等标记判断 Unreal / Unity / Godot / Cocos / Web，不要默认 Godot。\n2. 判断游戏类型与模板族；选最小能跑通核心循环的 primary_template，并说明备选模板。\n3. 输出模板能力合同：模板能支持的相机、输入、物理/碰撞、场景生命周期、实体 hook、UI/HUD、存档、音频、资产槽位和限制。\n4. 对齐 GDD：指出 GDD 中超出模板能力的设计、需要降级的需求、必须新增的 hook/API、可复用资产 key。\n5. 如用户要求落地，则按当前引擎直接修改或创建模板文件；否则只输出选择结果、能力文档和后续任务。\n6. 验收计划必须包含浏览器检查路径：Web/Phaser/Vite/Cocos 直接浏览器打开；Unity/Godot/Unreal 优先给出 WebGL/HTML harness/Pixel Streaming/可浏览预览路径，引擎检查只作为补充。`,
  "en-US":
    `Run game template capability selection: use the current request, GDD, project files, and existing code as input, choose the smallest viable game template from the Template Profile registry, then decide whether to implement. Do not generate workflow blueprints or IRGraph.\n\n${formatGameTemplateCatalogForPrompt("en-US")}\n\nFollow this process:\n1. Detect the project engine from .uproject, Packages/manifest.json + ProjectSettings, project.godot, project.json/assets, package.json, etc. across Unreal / Unity / Godot / Cocos / Web; never default to Godot.\n2. Classify the game type and template family; choose the smallest primary_template that can prove the core loop, and name fallback templates.\n3. Output the template capability contract: camera, input, physics/collision, scene lifecycle, entity hooks, UI/HUD, save, audio, asset slots, and limits.\n4. Align the GDD: flag design items beyond template capability, downgrade needs, required hooks/APIs, and reusable asset keys.\n5. If implementation is requested, edit/create the current-engine template files directly; otherwise output only the selection, capability doc, and next tasks.\n6. Acceptance plan must include a browser-check path: Web/Phaser/Vite/Cocos open directly in browser; Unity/Godot/Unreal prefer WebGL/HTML harness/Pixel Streaming/browser preview, with engine checks only supplemental.`,
};

const GAME_DEBUG_SKILL_TEXT = {
  "zh-CN":
    "执行游戏调试协议：复现问题、定位根因、修复，并用浏览器验证玩家可见结果。不要生成 workflow 蓝图或 IRGraph。\n\n请按以下流程完成：\n1. 判读当前引擎和运行入口，不默认 Godot；先找 README/package scripts/引擎配置/场景入口/构建命令。\n2. 复现问题：优先启动可浏览入口，用浏览器或 Playwright 打开；收集 console、network、截图、关键 DOM/canvas 状态和交互结果。\n3. 固定检查清单：asset key/manifest、场景注册、preload/create/update 生命周期、import/export、hook override、输入绑定、相机、碰撞、动画、UI 层级、音频加载、资源路径大小写。\n4. 修复代码或配置时保持最小改动；资产缺失时先用稳定占位和 manifest 记录，不虚构已生成资产。\n5. 修复后必须再次浏览器检查：Web/Phaser/Vite/Cocos 直接打开；Unity/Godot/Unreal 优先生成或使用 WebGL/HTML harness/Pixel Streaming/可浏览预览。对应引擎的 play/build/compile 可运行，但不能替代浏览器验收。\n6. 输出复现证据、根因、改动点、浏览器验证结果和残留风险；如果确实无法浏览器检查，说明缺少的具体入口或依赖。",
  "en-US":
    "Run the game debug protocol: reproduce, find root cause, fix, and validate the player-visible result in a browser. Do not generate workflow blueprints or IRGraph.\n\nFollow this process:\n1. Detect the engine and run entry without defaulting to Godot; inspect README/package scripts/engine config/scene entry/build commands first.\n2. Reproduce: prefer a browser-accessible entry, open it with a browser or Playwright, and collect console, network, screenshot, DOM/canvas state, and interaction result.\n3. Fixed checklist: asset key/manifest, scene registration, preload/create/update lifecycle, import/export, hook overrides, input bindings, camera, collision, animation, UI layering, audio loading, resource path casing.\n4. Keep fixes minimal; when assets are missing, use stable placeholders and record them in the manifest instead of inventing generated assets.\n5. After fixing, run browser verification again: Web/Phaser/Vite/Cocos direct browser; Unity/Godot/Unreal prefer WebGL/HTML harness/Pixel Streaming/browser preview. Engine play/build/compile may run, but cannot replace browser acceptance.\n6. Output reproduction evidence, root cause, changes, browser verification result, and remaining risk; if browser checking is impossible, name the missing entry or dependency.",
};

const GAME_VERIFY_REPORT_TEXT = {
  "zh-CN":
    "执行游戏验证报告：构建、启动、浏览器试玩检查，并给出可玩性评分。浏览器检查是硬验收；对应引擎检查只作为补充。不要生成 workflow 蓝图或 IRGraph。\n\n请按以下流程完成：\n1. 检测引擎和可运行入口，不默认 Godot；列出使用的命令、URL、场景或导出目标。\n2. 运行最相关的静态验证：typecheck/lint/test/build/compile/import check，按项目已有脚本执行。\n3. 启动可浏览版本并用浏览器检查：Web/Phaser/Vite/Cocos 直接访问 dev server 或静态 build；Unity/Godot/Unreal 优先 WebGL/HTML harness/Pixel Streaming/浏览器预览。若当前只有引擎编辑器入口，也要说明如何补可浏览入口。\n4. 浏览器内检查：首屏非空、canvas/viewport 尺寸、console error、network 404、资源加载、输入响应、核心循环、胜负/失败状态、UI 重叠、帧率/明显卡顿。\n5. 必要时截图或记录浏览器证据；发现问题直接修复并重测，直到能给出明确 pass/fail。\n6. 输出验证表：命令结果、浏览器结果、可玩性评分、失败项、阻塞项、建议下一步。",
  "en-US":
    "Run the game verification report: build, launch, browser play-check, and produce a playability score. Browser check is the hard acceptance gate; engine checks are supplemental only. Do not generate workflow blueprints or IRGraph.\n\nFollow this process:\n1. Detect the engine and runnable entry without defaulting to Godot; list the command, URL, scene, or export target used.\n2. Run the most relevant static checks: typecheck/lint/test/build/compile/import check using existing project scripts.\n3. Start a browser-accessible version and verify in browser: Web/Phaser/Vite/Cocos via dev server or static build; Unity/Godot/Unreal prefer WebGL/HTML harness/Pixel Streaming/browser preview. If only an editor entry exists, state how to add a browser-visible entry.\n4. In-browser checks: nonblank first screen, canvas/viewport size, console errors, network 404s, asset loading, input response, core loop, win/fail states, UI overlap, FPS/visible stutter.\n5. Capture screenshots or browser evidence when useful; fix and retest any found issues until pass/fail is clear.\n6. Output a verification table: command results, browser results, playability score, failed items, blockers, and next steps.",
};

export const GAME_SKILLS: GameSkill[] = [
  // ===== 一、游戏与编排 =====
  new GameSkill({
    name: "/game",
    category: "orchestration",
    label: { "zh-CN": "游戏专家视角", "en-US": "Game Expert Lens" },
    detail: {
      "zh-CN":
        "显式注入游戏开发专家约束；由当前编程模型单模型融合视角作答，不默认启动多 agent",
      "en-US":
        "Inject game-development expert constraints; the current coding model blends the views without default multi-agent orchestration",
    },
    insertText: { "zh-CN": "/game ", "en-US": "/game " },
    protocol: {
      triggers: "/game、游戏专家、game experts、找策划/程序/美术专家",
      allowedTools:
        "对话推理为主；落地时按检测引擎用 Read/Write/Bash（不默认 Godot）",
      steps: [
        "判断单点提问还是完整/多阶段需求",
        "选择 1-3 个最相关专家视角作为上下文约束",
        "由当前编程模型融合专家视角直接作答",
        "涉及实现时按工作区引擎给方案",
      ],
      outputFormat:
        "融合后的单一结论 + 必要专家约束 + 可执行建议；多阶段只附计划和验收清单",
      stopConditions:
        "问题被对应专家视角覆盖且给出可执行结论即结束；信息严重不足才询问",
      verification: "结论与请求阶段/角色对齐，建议可落到当前引擎，无凭空假设",
    },
  }),
  new GameSkill({
    name: "/studio",
    category: "orchestration",
    label: { "zh-CN": "Studio（已关闭）", "en-US": "Studio (disabled)" },
    detail: {
      "zh-CN":
        "源码保留但默认不展示、不执行；普通编程/文字任务交给当前编程模型单模型总控",
      "en-US":
        "Source retained but hidden and non-executable by default; coding/writing stays under the current model as the single controller",
    },
    protocol: {
      triggers: "/studio、动态编排、复杂任务、多智能体",
      allowedTools: "默认关闭；不应启动子进程 harness",
      steps: ["拦截命令", "提示用户直接描述任务", "由当前编程模型单模型处理"],
      outputFormat: "功能已关闭提示",
      stopConditions: "提示已给出即结束",
      verification: "不会启动 ugs studio，也不会写入 .ugs-run 运行账本",
    },
  }),
  new GameSkill({
    name: "/image-to-game",
    category: "orchestration",
    label: { "zh-CN": "图像驱动游戏开发", "en-US": "Image to Game" },
    detail: {
      "zh-CN":
        "从参考图、截图、文章链接或画面描述反推游戏方案、技术拆解和素材生成链路",
      "en-US":
        "Turn a reference image, screenshot, article link, or scene description into a game plan, technical breakdown, and asset pipeline",
    },
    insertText: IMAGE_TO_GAME_TEXT,
    protocol: {
      triggers: "/image-to-game、图像转游戏、参考图反推方案、截图做游戏",
      allowedTools: "视觉分析 + 当前引擎下 Read/Write/Bash；不默认 Godot",
      steps: [
        "画面规格",
        "玩法推断（区分推断与待验证）",
        "引擎实现拆解（按检测引擎，未识别则据项目文件判读）",
        "素材清单（生成/采购/手工）",
        "生成提示词",
        "MVP→原型→扩展计划与风险",
      ],
      outputFormat: "六段结构化方案，不输出 workflow 蓝图",
      stopConditions: "六段全覆盖且风险点列出即结束；除非明确要求才生成蓝图",
      verification:
        "实现章节与判读引擎一致；素材清单对应到生成提示词；风险含动作帧一致性/碰撞/版权",
    },
  }),
  new ModeStartSkill({
    name: "/gdd-mode-start",
    category: "orchestration",
    label: { "zh-CN": "开始 GDD 模式", "en-US": "Start GDD Mode" },
    detail: {
      "zh-CN":
        "进入 GDD 草稿模式：反复修改游戏设计、资产清单和落地计划，暂不生成正式资产或代码",
      "en-US":
        "Enter GDD draft mode: iterate game design, asset manifest, and implementation plan without final asset/code generation",
    },
    protocol: {
      triggers: "/gdd-mode-start、进入 GDD 模式、游戏设计文档、设计草稿",
      allowedTools:
        "Read/Write/Bash（仅维护 GDD 草稿、资产清单、实现计划和校验；不默认生成正式资产或代码）",
      steps: [
        "检测当前项目引擎和已有 GDD/设计文档，不默认 Godot",
        "从 30 个 Template Profile 中选择或推断 primary_template",
        "创建或更新 GDD 草稿，明确玩法循环、场景、系统、关卡、实体和验收标准",
        "同步维护资产清单和实现计划，记录新增/修改/删除影响",
        "每轮输出 GDD diff、待确认风险和下一步建议",
        "草稿期不生成正式资产、不写游戏实现代码；用户明确要求预览/占位时例外",
      ],
      outputFormat:
        "GDD 草稿更新 + asset_manifest + implementation_plan + 本轮 diff/风险；不输出 workflow 蓝图",
      stopConditions:
        "本轮设计修改被写入草稿或明确记录为待定，且没有阻塞性矛盾即结束",
      verification:
        "GDD、资产清单和实现计划互相一致；草稿期未误触发正式资产/代码生成",
    },
  }),
  new GameSkill({
    name: "/gdd-mode-end",
    category: "orchestration",
    label: { "zh-CN": "结束 GDD 模式", "en-US": "End GDD Mode" },
    detail: {
      "zh-CN":
        "冻结当前 GDD 修订，提取资产/场景/玩法合约，并开始按差异生成资产和落地代码",
      "en-US":
        "Freeze the current GDD revision, extract asset/scene/gameplay contracts, then implement changed assets and code",
    },
    protocol: {
      triggers: "/gdd-mode-end、退出 GDD 模式、冻结 GDD、按 GDD 落地",
      allowedTools:
        "Read/Write/Bash；按检测引擎执行构建/测试；可调用已配置素材渠道",
      steps: [
        "冻结当前 GDD 修订并生成版本号",
        "校验 primary_template 与 GDD/资产/代码计划一致",
        "校验玩法、场景、资产清单、实现计划和验收标准是否一致",
        "对比上一版 GDD，仅提取受影响资产和代码任务",
        "先生成或更新变更资产，再按 asset key/manifest 落地游戏代码",
        "运行当前项目可用的类型检查、构建、测试或启动校验",
        "启动可浏览版本并用浏览器检查核心循环；对应引擎检查只作为补充",
      ],
      outputFormat:
        "冻结版本 + GDD diff + 资产生成/复用清单 + 代码变更计划/结果 + 浏览器验证结果",
      stopConditions:
        "GDD 已冻结，受影响资产/代码已处理或明确阻塞原因，浏览器验证结果已汇报",
      verification:
        "冻结版 GDD 可追溯；asset_manifest 与实际资产/代码引用一致；浏览器验收已执行或说明缺少入口；引擎验证不替代浏览器验收",
    },
  }),
  new GameSkill({
    name: "/game-template-skill",
    category: "orchestration",
    label: { "zh-CN": "游戏模板能力选择", "en-US": "Game Template Skill" },
    detail: {
      "zh-CN":
        "按当前引擎、GDD 和游戏类型选择最小模板，输出模板能力合同和浏览器验收路径",
      "en-US":
        "Choose the smallest template from engine, GDD, and genre; output capability contract and browser acceptance path",
    },
    insertText: GAME_TEMPLATE_SKILL_TEXT,
    protocol: {
      triggers:
        "/game-template-skill、游戏模板、模板能力、template skill、按模板开发",
      allowedTools:
        "Read/Write/Bash；按检测引擎读取模板/脚本/场景；浏览器验收路径设计",
      steps: [
        "检测项目引擎和已有模板",
        "分类游戏类型与核心循环",
        "从 30 个 Template Profile 中选择最小可行模板",
        "输出模板能力合同、hook/API 和资产槽位",
        "对齐 GDD 并标出超出能力的需求",
        "给出浏览器验收路径；用户要求落地时直接改文件",
      ],
      outputFormat:
        "template_id + engine + capability_contract + GDD 对齐 diff + hook/API/asset slots + browser acceptance path",
      stopConditions:
        "模板选择和能力边界明确；需要落地时文件已改或阻塞原因明确",
      verification:
        "模板能力覆盖核心循环；GDD 超界项已标出；验收计划包含浏览器检查路径",
    },
  }),
  new GameSkill({
    name: "/game-debug-skill",
    category: "orchestration",
    label: { "zh-CN": "游戏调试协议", "en-US": "Game Debug Skill" },
    detail: {
      "zh-CN":
        "复现 -> asset/config/scene/hook 检查 -> 修复 -> 浏览器重测；引擎检查只补充",
      "en-US":
        "Reproduce -> asset/config/scene/hook checks -> fix -> browser retest; engine checks only supplement",
    },
    insertText: GAME_DEBUG_SKILL_TEXT,
    protocol: {
      triggers:
        "/game-debug-skill、游戏调试、修游戏 bug、asset key、scene bug、browser debug",
      allowedTools:
        "Read/Write/Bash/浏览器；可运行引擎构建或编译，但浏览器检查为硬验收",
      steps: [
        "检测引擎和运行入口",
        "用浏览器复现并采集 console/network/screenshot/交互证据",
        "按资产、配置、场景、导入、hook、输入、碰撞、UI 检查清单定位根因",
        "最小修复代码或配置",
        "再次浏览器验证，必要时运行引擎补充检查",
        "汇报根因、改动、浏览器结果和风险",
      ],
      outputFormat:
        "复现证据 + 根因 + 修复清单 + 浏览器验证结果 + 引擎补充检查 + 残留风险",
      stopConditions:
        "问题修复并浏览器验证通过；或明确缺少浏览器入口/依赖导致阻塞",
      verification:
        "浏览器里玩家可见问题已复测；console/network/asset key/scene lifecycle 无新增关键错误",
    },
  }),
  new GameSkill({
    name: "/game-verify-report",
    category: "orchestration",
    label: { "zh-CN": "游戏浏览器验收报告", "en-US": "Game Browser Verify Report" },
    detail: {
      "zh-CN":
        "构建/启动后通过浏览器试玩验收，输出可玩性评分；引擎检查只作为补充",
      "en-US":
        "Build/launch then browser play-check, output playability score; engine checks only supplement",
    },
    insertText: GAME_VERIFY_REPORT_TEXT,
    protocol: {
      triggers:
        "/game-verify-report、游戏验收、浏览器检查、可玩性评分、verify game",
      allowedTools:
        "Read/Write/Bash/浏览器；项目脚本、dev server、静态构建、WebGL/HTML harness/Pixel Streaming",
      steps: [
        "检测引擎和可运行入口",
        "运行 typecheck/lint/test/build/compile 等静态验证",
        "启动可浏览版本",
        "用浏览器检查首屏、canvas、console、network、资产、输入、核心循环和 UI",
        "发现问题则修复并重测",
        "输出验证表和可玩性评分",
      ],
      outputFormat:
        "验证表（命令/浏览器/引擎补充）+ 证据 + pass/fail + 可玩性评分 + 阻塞项",
      stopConditions:
        "浏览器验收得到明确 pass/fail；无法浏览器检查时列出具体缺口",
      verification:
        "浏览器验收已执行；引擎检查未被当成唯一验收；评分依据可追溯",
    },
  }),
  // ===== 二、生图 / 图像处理 =====
  new ModeStartSkill({
    name: "/image-mode-start",
    category: "image",
    label: { "zh-CN": "开始生图模式", "en-US": "Start Image Mode" },
    detail: {
      "zh-CN":
        "进入生图模式：之后每条消息都用设置 > 生图的默认 Provider 生成图片",
      "en-US":
        "Enter image mode: every message generates with the default image provider",
    },
    protocol: {
      triggers: "/image-mode-start、进入生图模式、开始生图",
      allowedTools: "设置 > 生图的默认 Provider",
      steps: ["开启后每条消息直接用默认生图 Provider 生成图片"],
      outputFormat: "生成的图片 + 使用的 Provider/尺寸",
      stopConditions: "本条图片生成成功即结束；Provider 未配置或失败则报告",
      verification: "产物为图片文件；Provider 与设置一致",
    },
  }),
  new ModeEndSkill({
    name: "/image-mode-end",
    category: "image",
    modeNameZh: "生图模式",
    label: { "zh-CN": "结束生图模式", "en-US": "End Image Mode" },
    detail: {
      "zh-CN": "退出生图模式，回到 AI 编程",
      "en-US": "Leave image mode and return to AI coding",
    },
  }),
  new ModeStartSkill({
    name: "/comfyui-mode-start",
    category: "image",
    label: { "zh-CN": "开始 ComfyUI 模式", "en-US": "Start ComfyUI Mode" },
    detail: {
      "zh-CN":
        "进入 ComfyUI 模式：之后每条消息都让编程模型生成一张 ComfyUI 节点图，内嵌在信息流中，可点开放大编辑并运行",
      "en-US":
        "Enter ComfyUI mode: every message has the coding model author a ComfyUI node graph, embedded in the chat and expandable to a full editor you can run",
    },
    protocol: {
      triggers: "/comfyui-mode-start、进入 ComfyUI 模式、节点图工作流",
      allowedTools: "编程模型生成 ComfyUI 节点图；内嵌编辑器运行",
      steps: [
        "开启后每条消息生成一张 ComfyUI 节点图，内嵌信息流，可展开放大编辑并运行",
      ],
      outputFormat: "可运行的 ComfyUI 节点图（内嵌可编辑）",
      stopConditions: "本条节点图生成且可运行即结束",
      verification: "节点图结构合法、可在编辑器内运行",
    },
  }),
  new ModeEndSkill({
    name: "/comfyui-mode-end",
    category: "image",
    modeNameZh: "ComfyUI 模式",
    label: { "zh-CN": "结束 ComfyUI 模式", "en-US": "End ComfyUI Mode" },
    detail: {
      "zh-CN": "退出 ComfyUI 模式，回到 AI 编程",
      "en-US": "Leave ComfyUI mode and return to AI coding",
    },
  }),
  // ===== 三、精灵图 / 帧序列 =====
  new GameSkill({
    name: "/sprite",
    category: "sprite",
    label: { "zh-CN": "生成 Sprite 资产", "en-US": "Generate Sprite Asset" },
    detail: {
      "zh-CN":
        "复用设置 > 生图渠道生成 raw spritesheet，并按 Sprite Forge 约束准备后处理与验收",
      "en-US":
        "Reuse Settings > Images to generate a raw spritesheet prepared for Sprite Forge postprocess and QC",
    },
    insertText: { "zh-CN": "/sprite ", "en-US": "/sprite " },
    protocol: {
      triggers: "/sprite、生成精灵、spritesheet、序列帧素材",
      allowedTools:
        "设置 > 生图渠道（生成 raw spritesheet）、Sprite Forge 后处理、Write",
      steps: [
        "复用生图渠道生成 raw spritesheet",
        "按 Sprite Forge 约束做后处理与验收",
      ],
      outputFormat: "raw spritesheet + 规范化后的帧/切分信息 + 验收结果",
      stopConditions: "sheet 生成且过 Sprite Forge 约束即结束；不符则重生成",
      verification: "帧尺寸/数量/朝向符合合约；透明背景干净；可被引擎切分导入",
    },
  }),
  new ModeStartSkill({
    name: "/sprite-mode-start",
    category: "sprite",
    label: { "zh-CN": "开始 Sprite 模式", "en-US": "Start Sprite Mode" },
    detail: {
      "zh-CN":
        "进入 Sprite 模式：先撰写 Sprite 合约提示词，再复用生图渠道生成可规范化的 raw sheet",
      "en-US":
        "Enter Sprite mode: write a Sprite contract prompt first, then reuse the image provider for a normalizable raw sheet",
    },
    protocol: {
      triggers: "/sprite-mode-start、进入精灵模式",
      allowedTools: "设置 > 生图渠道；编程模型撰写 Sprite 合约提示词",
      steps: [
        "开启后先写 Sprite 合约提示词，再复用生图渠道生成可规范化的 raw sheet",
      ],
      outputFormat: "可规范化的 raw spritesheet + 合约提示词",
      stopConditions: "本条 sheet 生成即结束",
      verification: "sheet 符合合约、可规范化",
    },
  }),
  new ModeEndSkill({
    name: "/sprite-mode-end",
    category: "sprite",
    modeNameZh: "Sprite 模式",
    label: { "zh-CN": "结束 Sprite 模式", "en-US": "End Sprite Mode" },
    detail: {
      "zh-CN": "退出 Sprite 模式，回到 AI 编程",
      "en-US": "Leave sprite mode and return to AI coding",
    },
  }),
  new GameSkill({
    name: "/video-to-frames",
    category: "sprite",
    label: { "zh-CN": "视频转动画帧", "en-US": "Video to Animation Frames" },
    detail: {
      "zh-CN":
        "调用 video-to-animation-frames Skill，把视频/GIF 拆成透明 PNG 序列帧、Sprite Sheet 和 manifest",
      "en-US":
        "Use the video-to-animation-frames Skill to convert video/GIF files into transparent PNG frames, a sprite sheet, and a manifest",
    },
    insertText: VIDEO_TO_FRAMES_TEXT,
    protocol: {
      triggers: "/video-to-frames、视频转帧、GIF 转序列帧、提取序列帧",
      allowedTools:
        "Bash（video-to-animation-frames 脚本、ffmpeg/ffprobe）、Read/Write",
      steps: [
        "识别输入路径/用途/当前引擎（不默认 Godot）",
        "优先用 Skill 脚本，检查 ffmpeg/ffprobe",
        "导出 PNG 序列帧，按需 chromakey 或 rembg 透明化",
        "需要时生成 sprite-sheet.png 与 manifest.json",
        "汇报结果",
      ],
      outputFormat:
        "透明 PNG 序列帧 + 可选 sprite-sheet + manifest；报告帧数、帧率、尺寸、透明方式、引擎导入建议",
      stopConditions:
        "序列帧落地且 manifest 完整即结束；缺 ffmpeg/ffprobe 报缺失依赖；缺视频路径才询问",
      verification:
        "帧序列连续完整；透明边缘干净；manifest 与实际帧一致；尺寸/帧率符合请求",
    },
  }),
  // ===== 四、3D / 建模 =====
  new ModeStartSkill({
    name: "/mesh-mode-start",
    category: "mesh",
    label: { "zh-CN": "开始 Mesh 模式", "en-US": "Start Mesh Mode" },
    detail: {
      "zh-CN":
        "进入 Mesh 模式：之后每条消息都先让编程模型撰写 3D 提示词，再调用默认 3D 渠道",
      "en-US":
        "Enter mesh mode: every message has the coding model write a 3D prompt, then calls the default 3D channel",
    },
    protocol: {
      triggers: "/mesh-mode-start、进入建模模式、3D 道具/角色/场景",
      allowedTools: "设置 > 默认 3D 渠道；编程模型撰写 3D 提示词",
      steps: ["开启后每条消息先写 3D 提示词，再调默认 3D 渠道生成模型"],
      outputFormat: "3D 模型产物 + 渠道、格式说明",
      stopConditions: "本条模型生成成功即结束；渠道失败则报告",
      verification: "产物为可导入 3D 模型；格式与引擎匹配",
    },
  }),
  new ModeEndSkill({
    name: "/mesh-mode-end",
    category: "mesh",
    modeNameZh: "Mesh 模式",
    label: { "zh-CN": "结束 Mesh 模式", "en-US": "End Mesh Mode" },
    detail: {
      "zh-CN": "退出 Mesh 模式，回到 AI 编程",
      "en-US": "Leave mesh mode and return to AI coding",
    },
  }),
  new GameSkill({
    name: "/mesh-search",
    category: "mesh",
    label: { "zh-CN": "搜索在线模型库", "en-US": "Search Model Libraries" },
    detail: {
      "zh-CN":
        "按关键字搜索 Sketchfab、Poly Haven、Fab、Unity Asset Store 等在线 3D 模型库，可下载的直接下载到会话",
      "en-US":
        "Search online 3D model libraries (Sketchfab, Poly Haven, Fab, Unity Asset Store, ...) by keyword; downloadable results are pulled into the chat",
    },
    protocol: {
      triggers:
        "/mesh-search、搜索 3D 模型、Sketchfab/Poly Haven/Fab/Unity Asset Store",
      allowedTools: "在线模型库检索 API；可下载项 Write 到会话",
      steps: [
        "按关键字搜索多个在线 3D 模型库",
        "列出结果与来源/授权",
        "可下载的直接拉入会话",
      ],
      outputFormat: "候选模型列表（名称/来源/授权/可否下载）+ 已下载文件路径",
      stopConditions: "返回匹配结果即结束；无结果则说明并建议改词",
      verification: "结果含来源与授权；下载文件可用；授权状态明确标注",
    },
  }),
  // ===== 五、音乐 =====
  new GameSkill({
    name: "/music",
    category: "music",
    label: { "zh-CN": "生成音乐", "en-US": "Generate Music" },
    detail: {
      "zh-CN": "调用设置 > 音乐渠道中的商用或免费渠道生成音乐/BGM",
      "en-US":
        "Generate music or BGM with the commercial or free channel configured in Settings > Music",
    },
    insertText: { "zh-CN": "/music ", "en-US": "/music " },
    protocol: {
      triggers: "/music、生成音乐、BGM、配乐",
      allowedTools: "设置 > 音乐渠道（商用或免费渠道）",
      steps: ["/music <描述> 直接调默认音乐渠道生成音乐/BGM"],
      outputFormat: "可播放音频/BGM 文件 + 渠道、时长、风格描述",
      stopConditions: "音频生成成功即结束；渠道未配置或失败则报告",
      verification: "产物为可播放音频；与请求风格/时长一致",
    },
  }),
  new ModeStartSkill({
    name: "/music-mode-start",
    category: "music",
    label: { "zh-CN": "开始音乐模式", "en-US": "Start Music Mode" },
    detail: {
      "zh-CN":
        "进入音乐模式：之后每条消息都先让编程模型撰写音乐提示词，再调用默认音乐渠道",
      "en-US":
        "Enter music mode: every message has the coding model write a music prompt, then calls the default music channel",
    },
    protocol: {
      triggers: "/music-mode-start、进入音乐模式",
      allowedTools: "设置 > 音乐渠道；编程模型撰写音乐提示词",
      steps: ["开启后每条消息先由编程模型写音乐提示词，再调默认音乐渠道"],
      outputFormat: "音频文件 + 自动生成的音乐提示词",
      stopConditions: "本条音频生成成功即结束",
      verification: "产物为可播放音频",
    },
  }),
  new ModeEndSkill({
    name: "/music-mode-end",
    category: "music",
    modeNameZh: "音乐模式",
    label: { "zh-CN": "结束音乐模式", "en-US": "End Music Mode" },
    detail: {
      "zh-CN": "退出音乐模式，回到 AI 编程",
      "en-US": "Leave music mode and return to AI coding",
    },
  }),
  // ===== 六、视频 =====
  new GameSkill({
    name: "/video",
    category: "video",
    label: { "zh-CN": "生成视频", "en-US": "Generate Video" },
    detail: {
      "zh-CN": "调用设置 > 视频渠道中的商用或免费渠道生成视频/短片",
      "en-US":
        "Generate video or short clips with the commercial or free channel configured in Settings > Video",
    },
    insertText: { "zh-CN": "/video ", "en-US": "/video " },
    protocol: {
      triggers: "/video、生成视频、短片、动态片段",
      allowedTools: "设置 > 视频渠道（商用或免费渠道）",
      steps: ["/video <描述> 直接调默认视频渠道生成视频/短片"],
      outputFormat: "视频/短片文件 + 渠道、时长、分辨率",
      stopConditions: "视频生成成功即结束；渠道失败则报告",
      verification: "产物为可播放视频；与请求一致",
    },
  }),
  new ModeStartSkill({
    name: "/video-mode-start",
    category: "video",
    label: { "zh-CN": "开始视频模式", "en-US": "Start Video Mode" },
    detail: {
      "zh-CN":
        "进入视频模式：之后每条消息都先让编程模型撰写视频提示词，再调用默认视频渠道",
      "en-US":
        "Enter video mode: every message has the coding model write a video prompt, then calls the default video channel",
    },
    protocol: {
      triggers: "/video-mode-start、进入视频模式",
      allowedTools: "设置 > 视频渠道；编程模型撰写视频提示词",
      steps: ["开启后每条消息先写视频提示词，再调默认视频渠道"],
      outputFormat: "视频文件 + 自动生成的视频提示词",
      stopConditions: "本条视频生成成功即结束",
      verification: "产物为可播放视频",
    },
  }),
  new ModeEndSkill({
    name: "/video-mode-end",
    category: "video",
    modeNameZh: "视频模式",
    label: { "zh-CN": "结束视频模式", "en-US": "End Video Mode" },
    detail: {
      "zh-CN": "退出视频模式，回到 AI 编程",
      "en-US": "Leave video mode and return to AI coding",
    },
  }),
  // ===== 七、语音 =====
  new GameSkill({
    name: "/tts",
    category: "speech",
    label: { "zh-CN": "文本转语音", "en-US": "Text to Speech" },
    detail: {
      "zh-CN": "调用设置 > 语音渠道中的商用或免费/本地渠道，把文字朗读成语音",
      "en-US":
        "Read text aloud with the commercial or free/local channel configured in Settings > Speech",
    },
    insertText: { "zh-CN": "/tts ", "en-US": "/tts " },
    protocol: {
      triggers: "/tts、文本转语音、配音、旁白朗读",
      allowedTools: "设置 > 语音渠道（商用或免费/本地渠道）",
      steps: ["/tts <文本> 直接调默认语音渠道朗读"],
      outputFormat: "语音音频文件 + 渠道、声音/语言",
      stopConditions: "音频生成成功即结束；渠道失败则报告",
      verification: "产物为音频且内容与文本一致",
    },
  }),
  new ModeStartSkill({
    name: "/speech-mode-start",
    category: "speech",
    label: { "zh-CN": "开始语音模式", "en-US": "Start Speech Mode" },
    detail: {
      "zh-CN": "进入语音模式：之后每条消息都直接调用默认语音渠道朗读",
      "en-US":
        "Enter speech mode: every message is sent straight to the default text-to-speech channel",
    },
    protocol: {
      triggers: "/speech-mode-start、进入语音模式",
      allowedTools: "设置 > 语音渠道",
      steps: ["开启后每条消息直接送默认语音渠道朗读"],
      outputFormat: "语音音频文件",
      stopConditions: "本条音频生成成功即结束",
      verification: "产物为音频且与文本一致",
    },
  }),
  new ModeEndSkill({
    name: "/speech-mode-end",
    category: "speech",
    modeNameZh: "语音模式",
    label: { "zh-CN": "结束语音模式", "en-US": "End Speech Mode" },
    detail: {
      "zh-CN": "退出语音模式，回到 AI 编程",
      "en-US": "Leave speech mode and return to AI coding",
    },
  }),
  // ===== 八、世界模型 =====
  new GameSkill({
    name: "/worldmodel",
    category: "worldmodel",
    label: { "zh-CN": "生成可玩世界模型", "en-US": "Generate World Model" },
    detail: {
      "zh-CN":
        "调用设置 > 世界模型渠道生成一个可交互世界定义，内嵌在信息流中可直接展开试玩",
      "en-US":
        "Generate an interactive world definition with the channel configured in Settings > World Models, embedded in the chat and playable on expand",
    },
    insertText: { "zh-CN": "/worldmodel ", "en-US": "/worldmodel " },
    protocol: {
      triggers: "/worldmodel、世界模型、可交互世界、可玩世界",
      allowedTools: "设置 > 世界模型渠道",
      steps: [
        "/worldmodel <描述> 调世界模型渠道生成可交互世界定义，内嵌信息流可试玩",
      ],
      outputFormat: "可交互世界定义（内嵌可展开试玩）+ 渠道说明",
      stopConditions: "世界定义生成且可试玩即结束；渠道失败则报告",
      verification: "产物可展开交互/试玩；定义结构合法",
    },
  }),
  new ModeStartSkill({
    name: "/worldmodel-mode-start",
    category: "worldmodel",
    label: { "zh-CN": "开始世界模型模式", "en-US": "Start World Model Mode" },
    detail: {
      "zh-CN":
        "进入世界模型模式：之后每条消息都让编程模型生成一个可交互世界并内嵌在信息流中，可点开直接试玩",
      "en-US":
        "Enter world-model mode: every message has the coding model author an interactive world embedded in the chat, expandable to play directly",
    },
    protocol: {
      triggers: "/worldmodel-mode-start、进入世界模型模式",
      allowedTools: "设置 > 世界模型渠道；编程模型生成可交互世界",
      steps: ["开启后每条消息都生成一个可交互世界并内嵌信息流，可点开试玩"],
      outputFormat: "可交互世界定义（内嵌可试玩）",
      stopConditions: "本条世界定义生成即结束",
      verification: "产物可试玩",
    },
  }),
  new ModeEndSkill({
    name: "/worldmodel-mode-end",
    category: "worldmodel",
    modeNameZh: "世界模型模式",
    label: { "zh-CN": "结束世界模型模式", "en-US": "End World Model Mode" },
    detail: {
      "zh-CN": "退出世界模型模式，回到 AI 编程",
      "en-US": "Leave world-model mode and return to AI coding",
    },
  }),
  // ===== 九、游戏 UI =====
  new ModeStartSkill({
    name: "/ui-mode-start",
    category: "ui",
    label: { "zh-CN": "开始 UI 模式", "en-US": "Start UI Mode" },
    detail: {
      "zh-CN":
        "进入 UI 模式：专门用于游戏 UI 设计，之后每条消息都让编程模型按默认 UI 渠道产出界面设计与可交付资产",
      "en-US":
        "Enter UI mode: dedicated to game UI design; every message has the coding model produce UI designs and deliverables for the default UI channel",
    },
    protocol: {
      triggers: "/ui-mode-start、进入 UI 模式、游戏 UI 设计",
      allowedTools: "默认 UI 渠道；编程模型产出界面设计与可交付资产；Write",
      steps: ["开启后每条消息按默认 UI 渠道产出游戏 UI 设计与可交付资产"],
      outputFormat: "UI 设计稿/可交付资产 + 规格说明",
      stopConditions: "本条 UI 设计与资产产出即结束",
      verification: "产物符合游戏 UI 规格、可交付",
    },
  }),
  new ModeEndSkill({
    name: "/ui-mode-end",
    category: "ui",
    modeNameZh: "UI 模式",
    label: { "zh-CN": "结束 UI 模式", "en-US": "End UI Mode" },
    detail: {
      "zh-CN": "退出 UI 模式，回到 AI 编程",
      "en-US": "Leave UI mode and return to AI coding",
    },
  }),
  // ===== 十、Unreal 专用 =====
  new ModeStartSkill({
    name: "/blueprint-mode-start",
    category: "unreal",
    label: { "zh-CN": "开始 UE 蓝图模式", "en-US": "Start UE Blueprint Mode" },
    detail: {
      "zh-CN":
        "进入 UE 蓝图模式：之后每条消息都按 Unreal Blueprint 创建、修改、编译和校验来处理",
      "en-US":
        "Enter UE Blueprint mode: every message is handled as Unreal Blueprint creation, editing, compilation, or verification",
    },
    protocol: {
      triggers: "/blueprint-mode-start、UE 蓝图、Unreal Blueprint",
      allowedTools:
        "Unreal Blueprint 创建/修改/编译/校验链路（引擎判读为 Unreal）",
      steps: ["开启后每条消息按 Blueprint 创建、修改、编译、校验处理"],
      outputFormat: "Blueprint 变更说明 + 编译/校验结果",
      stopConditions: "本条 Blueprint 编译/校验通过即结束；编译失败则报告",
      verification: "Blueprint 编译无错、校验通过",
    },
  }),
  new GameSkill({
    name: "/blueprint-mode-end",
    category: "unreal",
    label: { "zh-CN": "结束 UE 蓝图模式", "en-US": "End UE Blueprint Mode" },
    detail: {
      "zh-CN":
        "退出 UE 蓝图模式；可带 --commit、--discard、--verify、--compile 等收尾参数",
      "en-US":
        "Leave UE Blueprint mode; accepts closing options like --commit, --discard, --verify, or --compile",
    },
    protocol: {
      triggers: "/blueprint-mode-end、退出 UE 蓝图模式",
      allowedTools: "收尾参数 --commit/--discard/--verify/--compile",
      steps: ["按收尾参数提交、丢弃、校验或编译后退出蓝图模式"],
      outputFormat: "收尾状态报告（提交或丢弃 + 校验/编译结果）",
      stopConditions: "按参数收尾完成且模式关闭即结束",
      verification:
        "--commit/--discard 落到预期状态；--verify/--compile 结果正确；模式状态为关闭",
    },
  }),
  new ModeStartSkill({
    name: "/metahuman-mode-start",
    category: "unreal",
    label: {
      "zh-CN": "开始 MetaHuman MVP 模式",
      "en-US": "Start MetaHuman MVP Mode",
    },
    detail: {
      "zh-CN":
        "进入 MetaHuman MVP 模式：按“参考脸图、3D 人脸拟合、本地 UE MetaHuman Identity/Character”分阶段确认推进",
      "en-US":
        "Enter MetaHuman MVP mode: progress through reference face images, 3D face fitting, and local UE MetaHuman Identity/Character steps with staged confirmation",
    },
    protocol: {
      triggers: "/metahuman-mode-start、MetaHuman、UE 数字人",
      allowedTools:
        "参考脸图处理、3D 人脸拟合、本地 UE MetaHuman Identity/Character",
      steps: [
        '按"参考脸图 → 3D 人脸拟合 → 本地 UE MetaHuman Identity/Character"分阶段、逐阶段确认推进',
      ],
      outputFormat: "各阶段产物（脸图/拟合结果/MetaHuman 资产）+ 阶段确认点",
      stopConditions:
        "当前阶段产物完成且经确认才进入下一阶段；任一阶段失败则停止报告",
      verification: "每阶段产物可用且经确认；MetaHuman 资产可在本地 UE 打开",
    },
  }),
  new ModeEndSkill({
    name: "/metahuman-mode-end",
    category: "unreal",
    modeNameZh: "MetaHuman MVP 模式",
    label: {
      "zh-CN": "结束 MetaHuman MVP 模式",
      "en-US": "End MetaHuman MVP Mode",
    },
    detail: {
      "zh-CN": "退出 MetaHuman MVP 模式，回到 AI 编程",
      "en-US": "Leave MetaHuman MVP mode and return to AI coding",
    },
  }),
  // ===== 十一、会话导出 =====
  new GameSkill({
    name: "/screenshot",
    category: "session",
    label: { "zh-CN": "会话长截图", "en-US": "Session Screenshot" },
    detail: {
      "zh-CN": "把当前会话整段保存为长图（过长自动分页拼接）",
      "en-US":
        "Save the whole conversation as a long image (auto-paged when very long)",
    },
    protocol: {
      triggers: "/screenshot、会话截图、长图",
      allowedTools: "前端渲染/截图（应用内实现）",
      steps: ["把当前会话整段渲染为长图，过长时自动分页拼接"],
      outputFormat: "长图文件（必要时分页拼接为一张）",
      stopConditions: "图片生成成功即结束",
      verification: "图片含完整会话内容，分页拼接无截断",
    },
  }),
  new GameSkill({
    name: "/screenshot-gif",
    category: "session",
    label: { "zh-CN": "会话滚动 GIF", "en-US": "Session Scroll GIF" },
    detail: {
      "zh-CN": "把当前会话录成从上滚到下的回放 GIF",
      "en-US": "Record the conversation as a top-to-bottom scrolling GIF",
    },
    protocol: {
      triggers: "/screenshot-gif、会话 GIF、滚动回放",
      allowedTools: "前端录制/合成 GIF（应用内实现）",
      steps: ["把当前会话录成从上滚到下的回放 GIF"],
      outputFormat: "滚动回放 GIF 文件",
      stopConditions: "GIF 生成成功即结束",
      verification: "GIF 完整从顶滚到底，无丢帧/截断",
    },
  }),
];
