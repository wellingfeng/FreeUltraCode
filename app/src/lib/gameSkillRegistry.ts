// GameSkill registry: every UltraGameStudio-introduced slash command is authored
// from the GameSkill class hierarchy with its standard six-part protocol.
// `capabilityCatalog.ts` projects GAME_SKILLS into versioned manifests, and
// downstream surfaces consume those manifests.
//
// CONTRACT: Generic prompt shortcuts (/help, /plan, /diagnose, /review,
// /explain, /test) are NOT GameSkills and stay in capabilityCatalog.ts.
import { GameSkill, ModeStartSkill, ModeEndSkill } from "@/lib/gameSkill";

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
