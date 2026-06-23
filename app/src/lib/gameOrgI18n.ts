import defaultGameOrgDefinition from '@/config/gameOrgDefaults.json';
import type { Locale } from './i18n';

type LocaleText = {
  label?: string;
  summary?: string;
  role?: string;
  prompt?: string;
};

type SourceText = {
  label?: string;
  summary?: string;
  role?: string;
};

type SourceSkillText = SourceText & {
  prompt?: string;
};

interface RawGameOrgSkill {
  id?: unknown;
  label?: unknown;
  summary?: unknown;
  prompt?: unknown;
}

interface RawGameOrgNode {
  id?: unknown;
  label?: unknown;
  summary?: unknown;
  role?: unknown;
  skills?: unknown;
  children?: unknown;
}

const DEFAULT_NODE_TEXT = new Map<string, SourceText>();
const DEFAULT_SKILL_TEXT = new Map<string, SourceSkillText>();

function sourceString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function collectDefaultText(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const node = value as RawGameOrgNode;
  const id = sourceString(node.id);
  if (!id) return;

  DEFAULT_NODE_TEXT.set(id, {
    label: sourceString(node.label),
    summary: sourceString(node.summary),
    role: sourceString(node.role),
  });

  if (Array.isArray(node.skills)) {
    for (const rawSkill of node.skills) {
      if (!rawSkill || typeof rawSkill !== 'object' || Array.isArray(rawSkill)) {
        continue;
      }
      const skill = rawSkill as RawGameOrgSkill;
      const skillId = sourceString(skill.id);
      if (!skillId) continue;
      DEFAULT_SKILL_TEXT.set(`${id}:${skillId}`, {
        label: sourceString(skill.label),
        summary: sourceString(skill.summary),
        prompt: sourceString(skill.prompt),
      });
    }
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) collectDefaultText(child);
  }
}

collectDefaultText(defaultGameOrgDefinition);

const NODE_TEXT: Record<string, Partial<Record<Locale, LocaleText>>> = {
  producer: {
    'en-US': {
      label: 'Producer',
      summary:
        'Project-level lens for goals, scope, schedule, risk, and cross-discipline constraints.',
      role:
        'Turns requirements into shippable phases and blends design, engineering, art, audio, QA, release, and live-ops perspectives.',
    },
  },
  'creative-director': {
    'en-US': {
      label: 'Creative Director',
      summary:
        'Owns the game vision, gameplay direction, system design, and player experience.',
    },
  },
  'game-designer': {
    'en-US': {
      label: 'Game Designer',
      summary: 'Gameplay loops, rules, balance, and player-facing tuning.',
    },
  },
  'systems-designer': {
    'en-US': {
      label: 'Systems Designer',
      summary: 'System rules, formulas, progression, dependencies, and tuning surfaces.',
    },
  },
  'economy-designer': {
    'en-US': {
      label: 'Economy / Balance Design',
      summary: 'Currencies, sources, sinks, growth curves, rewards, and economy health.',
    },
  },
  'level-designer': {
    'en-US': {
      label: 'Level Design',
      summary: 'Pacing, guidance, difficulty curves, encounter flow, and spatial readability.',
    },
  },
  'narrative-team': {
    'en-US': {
      label: 'Narrative & Worldbuilding',
      summary:
        'Story structure, characters, world rules, quest narrative, and lore consistency.',
    },
  },
  'narrative-director': {
    'en-US': {
      label: 'Narrative Director',
      summary: 'Story structure, character arcs, world rules, and narrative systems.',
    },
  },
  writer: {
    'en-US': {
      label: 'Writer',
      summary: 'Dialogue, item text, logs, player-facing copy, and localization-ready text.',
    },
  },
  'world-builder': {
    'en-US': {
      label: 'World Builder',
      summary: 'Factions, culture, history, geography, ecology, and world consistency.',
    },
  },
  'technical-director': {
    'en-US': {
      label: 'Technical Director',
      summary:
        'Owns engineering architecture, technical plans, complexity, performance budgets, and cross-platform risk.',
    },
  },
  'client-development': {
    'en-US': {
      label: 'Client Development',
      summary:
        'Owns gameplay implementation, input, UI integration, state machines, and client presentation.',
    },
  },
  'engine-development': {
    'en-US': {
      label: 'Engine Development',
      summary:
        'Owns engine-level capabilities, rendering, assets, framework code, and platform adaptation.',
    },
  },
  'engine-programmer': {
    'en-US': {
      label: 'Engine Programmer',
      summary:
        'Rendering, physics, memory, loading, core frameworks, and performance-critical systems.',
    },
  },
  'unity-specialist': {
    'en-US': {
      label: 'Unity Specialist',
      summary: 'Unity, C#, Prefabs, Scenes, assets, serialization, and runtime lifecycle.',
    },
  },
  'unreal-specialist': {
    'en-US': {
      label: 'Unreal Specialist',
      summary: 'Unreal, C++, Blueprint, Gameplay Framework, GAS, and replication.',
    },
  },
  'godot-specialist': {
    'en-US': {
      label: 'Godot Specialist',
      summary: 'Godot, GDScript, C#, nodes, scenes, signals, and resources.',
    },
  },
  'backend-development': {
    'en-US': {
      label: 'Backend / Multiplayer',
      summary:
        'Owns network sync, server authority, telemetry, security, and live-service stability.',
    },
  },
  'technical-artist': {
    'en-US': {
      label: 'Technical Artist',
      summary: 'Art pipelines, shaders, materials, VFX, import rules, and performance budgets.',
    },
  },
  'tools-devops': {
    'en-US': {
      label: 'Tools / DevOps',
      summary: 'Editor tooling, build automation, CI/CD, packaging, and release infrastructure.',
    },
  },
  'save-and-ai': {
    'en-US': {
      label: 'Save / AI Systems',
      summary: 'Save data, migration, recovery, game AI, behavior trees, and debugging tools.',
    },
  },
  'art-director': {
    'en-US': {
      label: 'Art Director',
      summary:
        'Owns visual style, asset standards, the art bible, and consistency across art production.',
    },
  },
  'concept-art': {
    'en-US': {
      label: '2D Art / Concept',
      summary: 'Concept direction, palettes, shape language, mood targets, and visual exploration.',
    },
  },
  'character-art': {
    'en-US': {
      label: 'Character Art',
      summary: 'Character silhouettes, materials, equipment, rig constraints, and animation specs.',
    },
  },
  'environment-art': {
    'en-US': {
      label: 'Environment Art',
      summary: 'Environment mood, scene assets, level readability, and production specs.',
    },
  },
  'ui-design': {
    'en-US': {
      label: 'UI Design',
      summary: 'Interface hierarchy, states, feedback, motion, accessibility, and input support.',
    },
  },
  'vfx-shader': {
    'en-US': {
      label: 'VFX / Shader',
      summary: 'VFX style, combat readability, shader cost, reuse templates, and fallback plans.',
    },
  },
  'audio-director': {
    'en-US': {
      label: 'Audio Director',
      summary: 'Owns audio vision, mix direction, music identity, and consistent sound feedback.',
    },
  },
  'sound-designer': {
    'en-US': {
      label: 'Sound Design',
      summary: 'SFX feedback, audio events, variation, mix priority, and implementation cues.',
    },
  },
  'qa-lead': {
    'en-US': {
      label: 'QA Lead',
      summary: 'Owns test strategy, quality gates, defect flow, and release readiness.',
    },
  },
  'qa-tester': {
    'en-US': {
      label: 'Functional QA',
      summary: 'Reproduction steps, coverage gaps, severity, regression, and player-impact risk.',
    },
  },
  'performance-qa': {
    'en-US': {
      label: 'Performance QA',
      summary: 'Frame rate, memory, loading, stutter, profiling, and performance regressions.',
    },
  },
  'accessibility-qa': {
    'en-US': {
      label: 'Accessibility QA',
      summary:
        'Color, subtitles, remapping, difficulty assists, motion sensitivity, and readable UX.',
    },
  },
  'release-ops': {
    'en-US': {
      label: 'Release / Live Ops',
      summary:
        'Owns release readiness, launch cadence, live events, and data-driven iteration.',
    },
  },
  'release-manager': {
    'en-US': {
      label: 'Release Manager',
      summary: 'Platform certification, store submission, versioning, launch day, and rollback.',
    },
  },
  'community-manager': {
    'en-US': {
      label: 'Community',
      summary: 'Announcements, feedback intake, sentiment response, and player communication.',
    },
  },
  'localization-lead': {
    'en-US': {
      label: 'Localization',
      summary: 'Text extraction, variables, fonts, cultural review, and localization regression.',
    },
  },
  'analytics-engineer': {
    'en-US': {
      label: 'Analytics',
      summary: 'Telemetry, event naming, funnels, retention, experiments, and data validation.',
    },
  },
};

const SKILL_TEXT: Record<string, Partial<Record<Locale, LocaleText>>> = {
  'producer:start-new-game': {
    'en-US': {
      label: 'Start a New Game Project',
      summary:
        'Break out goals, pipeline phases, milestones, risks, and the first verifiable slice.',
      prompt:
        'Start a new game project: clarify the game goals, core loop, target platforms, first playable slice, milestones, risks, and acceptance criteria.',
    },
  },
  'producer:scope-change': {
    'en-US': {
      label: 'Revise Project Goals',
      summary:
        'Assess how scope changes affect design, engineering, art, schedule, and quality gates.',
      prompt:
        'Revise game project goals: assess the scope change, affected lenses, assets that must be redone, schedule risk, and the new acceptance criteria.',
    },
  },
  'creative-director:design-direction': {
    'en-US': {
      label: 'Set Gameplay Direction',
      summary: 'Turn a concept into a core loop, player verbs, and experience pillars.',
      prompt:
        'Set gameplay direction: provide the core loop, player verbs, experience pillars, key systems, and a minimum playable validation plan.',
    },
  },
  'creative-director:design-review': {
    'en-US': {
      label: 'Review Design Plan',
      summary: 'Check gameplay goals, system complexity, tuning surfaces, and feedback paths.',
      prompt:
        'Review the design plan: check risks around core experience, rule clarity, system complexity, tuning surfaces, and player feedback paths.',
    },
  },
  'game-designer:design-mechanic': {
    'en-US': {
      label: 'Design Gameplay Mechanic',
      summary: 'Break a mechanic into rules, states, input, and feedback loops.',
      prompt:
        'Design the gameplay mechanic: break this mechanic into rules, state machines, player input, immediate feedback, failure/victory conditions, edge cases, and a minimum playable validation plan.',
    },
  },
  'game-designer:tune-game-feel': {
    'en-US': {
      label: 'Tune Game Feel',
      summary: 'Tune input response, pacing, feedback curves, and impact feel.',
      prompt:
        'Tune game feel: list the parameters that affect feel, including input latency, animation canceling, hit feedback, camera, and rumble. Provide suggested ranges, tuning order, and validation methods.',
    },
  },
  'systems-designer:design-system-loop': {
    'en-US': {
      label: 'Design System Loop',
      summary: 'Build the production-consumption-growth loop and dependencies.',
      prompt:
        'Design the system loop: define resources/states, production and consumption paths, dependencies between systems, growth motivations, long-term retention hooks, and risky coupling points.',
    },
  },
  'systems-designer:systems-review': {
    'en-US': {
      label: 'Review System Design',
      summary: 'Check system complexity, coupling, tuning surfaces, and extensibility.',
      prompt:
        'Review the system design: check rule clarity, system coupling, tuning surfaces, boundaries, exploit space, and extensibility. Suggest simplifications or splits.',
    },
  },
  'economy-designer:build-economy-model': {
    'en-US': {
      label: 'Build Economy Model',
      summary: 'Define currencies, sources, sinks, inflation control, and recycling paths.',
      prompt:
        'Build the economy model: define currency types, sources, sinks, recycling/sink mechanisms, inflation controls, key balance metrics, and an adjustable tuning table structure.',
    },
  },
  'economy-designer:tune-balance-curve': {
    'en-US': {
      label: 'Tune Balance Curves',
      summary: 'Fit progression curves, difficulty curves, and drop or monetization rates.',
      prompt:
        'Tune balance curves: provide target shapes for progression/difficulty curves, key node values, drop or monetization probability design, validation metrics, and regression checks.',
    },
  },
  'level-designer:design-level-blockout': {
    'en-US': {
      label: 'Design Level Blockout',
      summary: 'Plan pacing, guidance, difficulty curves, and spatial readability.',
      prompt:
        'Design the level blockout: provide level goals, pacing map, player path and guidance signals, difficulty curve, reward points, readability notes, and the areas that need blockout validation.',
    },
  },
  'level-designer:level-review': {
    'en-US': {
      label: 'Review Level',
      summary: 'Check player paths, blockers, guidance, and difficulty spikes.',
      prompt:
        'Review the level: check player path clarity, blocker and lost-player risks, guidance signals, difficulty spikes, and camera readability. Provide fixes.',
    },
  },
  'narrative-team:build-story-spine': {
    'en-US': {
      label: 'Build Story Spine',
      summary: 'Integrate worldbuilding, main plot, and character arcs into a playable structure.',
      prompt:
        'Build the story spine: provide main story structure, key turns, character arcs, world-rule constraints, links to gameplay pacing, and handoff points between narrative and systems.',
    },
  },
  'narrative-team:narrative-gameplay-sync': {
    'en-US': {
      label: 'Align Narrative and Gameplay',
      summary: 'Make story beats, levels, and system progression support each other.',
      prompt:
        'Align narrative and gameplay: map story beats to level/system progression, check conflicts between narrative pace and gameplay pace, and propose cutscenes, triggers, and reward beats.',
    },
  },
  'narrative-director:narrative-bible': {
    'en-US': {
      label: 'Create Narrative Bible',
      summary: 'Unify tone, theme, characters, and narrative presentation rules.',
      prompt:
        'Create the narrative bible: provide theme, tone, core conflict, main character arcs, narrative presentation rules, cross-functional constraints, and gameplay integration points.',
    },
  },
  'writer:write-dialogue': {
    'en-US': {
      label: 'Write Dialogue Script',
      summary: 'Produce character-consistent dialogue and branching text.',
      prompt:
        'Write the dialogue script: produce dialogue for the characters and situation, mark branch conditions, emotional beats, localization variables, and keep it consistent with the worldbuilding.',
    },
  },
  'world-builder:define-world-rules': {
    'en-US': {
      label: 'Define World Rules',
      summary: 'Organize geography, factions, history, and consistency rules.',
      prompt:
        'Define world rules: provide geography, factions, historical framework, internal consistency rules, visual and gameplay hooks, and elements that need art and level design follow-up.',
    },
  },
  'technical-director:feature-development': {
    'en-US': {
      label: 'Start Feature Development',
      summary: 'Analyze a feature through client, engine, backend, technical art, and QA lenses.',
      prompt:
        'Start feature development: use the Technical Director lens to analyze client, engine, backend, technical art, and QA concerns, interfaces, risks, and acceptance criteria. Provide lens guidance only; the current coding model decides whether to split the task.',
    },
  },
  'technical-director:architecture-review': {
    'en-US': {
      label: 'Review Technical Plan',
      summary: 'Check architecture boundaries, dependencies, performance, saves, networking, and testability.',
      prompt:
        'Review the technical plan: check architecture boundaries, module dependencies, performance budget, save/networking impact, test entry points, and refactor risk.',
    },
  },
  'technical-director:ue-architecture-review': {
    'en-US': {
      label: 'Strict UE Architecture Review',
      summary:
        'Run a high-bar Unreal Gameplay Framework, module-boundary, reflection/replication/GAS, performance, and automation-test architecture review.',
      prompt:
        'Strict UE architecture review: use the Technical Director lens for a red-team architecture review. Default to a high bar; treat missing evidence as a blocker instead of passing by assumption. Check Unreal Engine / UE5 practices: Gameplay Framework ownership, UObject/Actor lifecycle, C++ and Blueprint split, reflection macros and UPROPERTY/UFUNCTION exposure, module/plugin boundaries, GAS boundaries, networking replication and server authority, soft references and async loading, Tick/Timer/Delegate/Event usage, save migration, Unreal Insights measurement, and automation/functional test entry points. Return a go/no-go verdict, must-fix items, should-fix items, acceptable tradeoffs, validation checklist, and smallest refactor path.',
    },
  },
  'technical-director:performance-budget': {
    'en-US': {
      label: 'Define Performance Budget',
      summary: 'Break out CPU, GPU, memory, loading, and regression metrics.',
      prompt:
        'Define the performance budget: provide CPU/GPU/memory/loading targets for the target platforms, measurement methods, fallback strategies, and regression gates.',
    },
  },
  'client-development:client-feature-slice': {
    'en-US': {
      label: 'Break Down Client Implementation',
      summary: 'Split gameplay requirements into components, states, events, UI, and acceptance cases.',
      prompt:
        'Break down client implementation: provide component boundaries, state machines, event flow, UI integration, edge cases, and acceptance tests.',
    },
  },
  'client-development:client-perf-pass': {
    'en-US': {
      label: 'Investigate Client Performance',
      summary: 'Locate frame hitches, GC, memory, and loading issues with fixes.',
      prompt:
        'Investigate client performance: locate frame-rate spikes, GC/memory allocation, loading and instantiation cost. Provide repro scenes, measurements, and prioritized fixes.',
    },
  },
  'engine-development:engine-tech-selection': {
    'en-US': {
      label: 'Select and Adapt Engine',
      summary: 'Compare engine capability, platform support, and team cost.',
      prompt:
        'Select and adapt the engine: compare candidate engines across rendering, performance, platform support, ecosystem, and team familiarity. Recommend a choice, migration/adaptation cost, and key risks.',
    },
  },
  'engine-programmer:engine-subsystem': {
    'en-US': {
      label: 'Design Engine Subsystem',
      summary: 'Plan subsystem interfaces and lifecycle for rendering/assets/framework capability.',
      prompt:
        'Design the engine subsystem: define subsystem responsibilities, public interfaces, lifecycle, threading model, memory/resource strategy, exposure to gameplay, and test entry points.',
    },
  },
  'unity-specialist:unity-feature-plan': {
    'en-US': {
      label: 'Implement Unity Plan',
      summary: 'Use Unity lifecycle, serialization, and asset pipeline constraints.',
      prompt:
        'Implement the Unity plan: use MonoBehaviour lifecycle, serialization, Addressables/asset pipelines, and performance characteristics to propose structure, common pitfalls, and validation steps.',
    },
  },
  'unreal-specialist:unreal-feature-plan': {
    'en-US': {
      label: 'Implement Unreal Plan',
      summary: 'Use Actor, GAS, replication, and Blueprint/C++ boundaries.',
      prompt:
        'Implement the Unreal plan: use Actor lifecycle, GAS, networking replication, and Blueprint/C++ responsibility split to propose structure, replication/authority boundaries, and validation steps.',
    },
  },
  'godot-specialist:godot-feature-plan': {
    'en-US': {
      label: 'Implement Godot Plan',
      summary: 'Use scene trees, signals, and scene instancing effectively.',
      prompt:
        'Implement the Godot plan: use scene trees, signals, scene instancing, and GDScript/C# tradeoffs to propose structure, decoupling approach, and validation steps.',
    },
  },
  'backend-development:netcode-design': {
    'en-US': {
      label: 'Design Network Sync',
      summary: 'Choose sync model, authority boundary, lag compensation, and anti-cheat approach.',
      prompt:
        'Design network sync: provide the sync model, server authority boundaries, lag compensation and rollback strategy, bandwidth budget, anti-cheat points, and test methods.',
    },
  },
  'backend-development:backend-service-plan': {
    'en-US': {
      label: 'Plan Backend Services',
      summary: 'Break down account, save, matchmaking, ranking, and capacity interfaces.',
      prompt:
        'Plan backend services: break down account/save/matchmaking/ranking services, APIs, data models, capacity and scaling strategy, failure fallback, and monitoring metrics.',
    },
  },
  'technical-artist:art-pipeline-setup': {
    'en-US': {
      label: 'Set Up Art Pipeline',
      summary: 'Define asset specs, import flow, naming, and automated validation.',
      prompt:
        'Set up the art pipeline: define asset specs, import and naming conventions, automated validation points, engine handoff, and common causes of rework.',
    },
  },
  'technical-artist:shader-optimization': {
    'en-US': {
      label: 'Optimize Shader / Rendering',
      summary: 'Balance material and rendering cost against visual quality.',
      prompt:
        'Optimize shader/rendering: locate rendering cost sources and propose material, batching, overdraw, resolution, and VFX optimizations sorted by performance budget and regression method.',
    },
  },
  'tools-devops:build-pipeline': {
    'en-US': {
      label: 'Build Release Pipeline',
      summary: 'Plan automated builds, multi-platform packaging, and distribution.',
      prompt:
        'Build the release pipeline: provide automated build triggers, multi-platform packaging steps, artifact validation, versioning and release-channel strategy, rollback, and notifications.',
    },
  },
  'tools-devops:editor-tooling': {
    'en-US': {
      label: 'Develop Editor Tooling',
      summary: 'Build productivity tools for design, art, level design, and batch workflows.',
      prompt:
        'Develop editor tooling: clarify target users and pain points, tool features, data sources, interaction model, batch capabilities, and safeguards against mistakes.',
    },
  },
  'save-and-ai:save-system-design': {
    'en-US': {
      label: 'Design Save System',
      summary: 'Plan serialization, version migration, corruption protection, and cloud sync.',
      prompt:
        'Design the save system: provide save data structure, serialization format, version migration, corruption protection/atomic writes, cloud sync conflict handling, and test scenarios.',
    },
  },
  'save-and-ai:game-ai-behavior': {
    'en-US': {
      label: 'Design Game AI Behavior',
      summary: 'Choose behavior tree/state machine/pathfinding approach with tunability and performance.',
      prompt:
        'Design game AI behavior: provide decision architecture, perception and pathfinding approach, tunable parameters, performance budget, and debug visualization.',
    },
  },
  'art-director:style-change': {
    'en-US': {
      label: 'Change Art Style',
      summary: 'Analyze a new style through 2D, character, environment, UI, technical art, and QA lenses.',
      prompt:
        'Change the game art style: use the Art Director lens to define style pillars, color/material/silhouette rules, and list changes from 2D, character, environment, UI, technical art, and QA lenses. Provide lens guidance only; the current coding model decides whether to split the task.',
    },
  },
  'art-director:asset-review': {
    'en-US': {
      label: 'Review Assets',
      summary: 'Check style fit, specs, performance, delivery format, and camera readability.',
      prompt:
        'Review assets: check style consistency, camera readability, resource specs, performance budget, and delivery format.',
    },
  },
  'concept-art:concept-exploration': {
    'en-US': {
      label: 'Explore Concepts',
      summary: 'Quickly produce directions, palettes, and shape language around a theme.',
      prompt:
        'Explore concepts: provide 2-3 visual directions, palettes, shape language, and reference imagery around the theme. Explain each direction’s mood and its 3D/level implementation risks.',
    },
  },
  'character-art:character-spec': {
    'en-US': {
      label: 'Define Character Specs',
      summary: 'Define unified silhouette, color, material, and equipment specs.',
      prompt:
        'Define character specs: provide silhouette/readability points, color/material rules, equipment/part breakdown, polygon and rig budgets, and animation/technical art handoff requirements.',
    },
  },
  'environment-art:environment-kit': {
    'en-US': {
      label: 'Build Environment Kit',
      summary: 'Plan modular assets, reuse rules, and camera readability.',
      prompt:
        'Build the environment kit: provide modular breakdown, reuse and snapping rules, lighting/material mood, camera readability notes, performance budget, and level-design space requirements.',
    },
  },
  'ui-design:ui-flow-design': {
    'en-US': {
      label: 'Design UI Flow',
      summary: 'Map interface hierarchy, states, feedback, and accessibility.',
      prompt:
        'Design the UI flow: provide screen hierarchy and navigation, state/empty/error/loading states, feedback and motion, input-device adaptation, accessibility notes, and data-binding handoff.',
    },
  },
  'vfx-shader:vfx-spec': {
    'en-US': {
      label: 'Define VFX Spec',
      summary: 'Unify VFX style, readability, and performance budget.',
      prompt:
        'Define the VFX spec: provide VFX style and readability rules, particle/material budgets, reuse templates, fallback strategies, and links to gameplay feedback.',
    },
  },
  'audio-director:audio-direction': {
    'en-US': {
      label: 'Set Audio Direction',
      summary: 'Define music style, sound identity, dynamic mixing, and feedback layers.',
      prompt:
        'Set audio direction: provide music style, SFX identity, dynamic mixing and priority layers, key gameplay feedback sounds, scene-emotion mapping, and implementation specs.',
    },
  },
  'sound-designer:sfx-feedback': {
    'en-US': {
      label: 'Design Feedback SFX',
      summary: 'Create immediate, readable, non-fatiguing SFX for gameplay events.',
      prompt:
        'Design feedback SFX: map key gameplay events to sound effects, define layers and variations, avoid repetition fatigue, set mix priority, implementation triggers, and dynamic-mix handoff.',
    },
  },
  'qa-lead:test-plan': {
    'en-US': {
      label: 'Create Test Plan',
      summary: 'Split test scope, cases, regression, and release gates by risk.',
      prompt:
        'Create the test plan: split test scope by risk, key cases, regression set, coverage gaps, defect severity standards, release gates, and automation candidates.',
    },
  },
  'qa-tester:repro-and-report': {
    'en-US': {
      label: 'Reproduce and Triage Bug',
      summary: 'Provide stable repro steps, environment, impact, and severity.',
      prompt:
        'Reproduce and triage the defect: provide stable repro steps, environment and prerequisites, expected vs actual behavior, impact scope and severity, and likely triggering modules for engineering investigation.',
    },
  },
  'performance-qa:perf-profiling': {
    'en-US': {
      label: 'Profile and Locate Performance Issue',
      summary: 'Measure FPS, memory, loading, and stutter against the performance budget.',
      prompt:
        'Profile and locate performance issues: measure frame rate, memory, loading, and stutter against the budget, locate CPU/GPU/IO bottlenecks, and provide repro scenes, measurements, and optimization priorities.',
    },
  },
  'accessibility-qa:accessibility-audit': {
    'en-US': {
      label: 'Run Accessibility Audit',
      summary: 'Check color, subtitles, remapping, and assist options.',
      prompt:
        'Run an accessibility audit: check color contrast/colorblind support, subtitles and audio cues, input remapping, difficulty and assist options, motion sensitivity, and provide prioritized improvements.',
    },
  },
  'release-ops:release-readiness': {
    'en-US': {
      label: 'Assess Release Readiness',
      summary: 'Check quality gates, store assets, compliance, and rollback plan.',
      prompt:
        'Assess release readiness: check quality gates, blocking defects, store assets and ratings/compliance, rollout and rollback plan, monitoring and incident response, and give a go/no-go conclusion.',
    },
  },
  'release-manager:release-plan': {
    'en-US': {
      label: 'Plan Release Cadence',
      summary: 'Schedule versions, rollout, platform review, hotfixes, and rollback windows.',
      prompt:
        'Plan release cadence: lay out version milestones, rollout percentages, platform review times, hotfix and rollback windows, external communication points, and key risks.',
    },
  },
  'community-manager:community-plan': {
    'en-US': {
      label: 'Plan Community Communication',
      summary: 'Plan announcements, feedback intake, and launch sentiment response.',
      prompt:
        'Plan community communication: provide release announcement points, feedback intake channels, launch sentiment monitoring and response language, and a process for turning player feedback into product issues and acceptance checks.',
    },
  },
  'localization-lead:localization-plan': {
    'en-US': {
      label: 'Plan Localization',
      summary: 'Handle text extraction, variables, fonts, cultural review, and regression.',
      prompt:
        'Plan localization: provide text extraction and key management, variables/plurals/gender handling, font and layout expansion, cultural and compliance review, and localization regression testing.',
    },
  },
  'analytics-engineer:analytics-funnel': {
    'en-US': {
      label: 'Build Telemetry and Funnel',
      summary: 'Define key metrics, events, retention, conversion funnels, and experiments.',
      prompt:
        'Build telemetry and funnel: provide north-star metrics, key events, event naming, retention/conversion funnels, A/B experiment definitions, and data validation methods.',
    },
  },
};

function localizedMapText(
  map: Record<string, Partial<Record<Locale, LocaleText>>>,
  id: string,
  locale: Locale,
): LocaleText | undefined {
  if (locale === 'zh-CN') return undefined;
  return map[id]?.[locale] ?? map[id]?.['en-US'];
}

function builtInText(
  current: string | undefined,
  source: string | undefined,
  translated: string | undefined,
): string | undefined {
  if (!translated) return current;
  if (!current) return translated;
  return current === source ? translated : current;
}

export function localizeGameOrgNodeText(
  nodeId: string,
  locale: Locale,
  text: SourceText,
): SourceText {
  const translated = localizedMapText(NODE_TEXT, nodeId, locale);
  if (!translated) return text;

  const source = DEFAULT_NODE_TEXT.get(nodeId);
  return {
    label: builtInText(text.label, source?.label, translated.label),
    summary: builtInText(text.summary, source?.summary, translated.summary),
    role: builtInText(text.role, source?.role, translated.role),
  };
}

export function localizeGameOrgSkillText(
  nodeId: string,
  skillId: string,
  locale: Locale,
  text: SourceSkillText,
): SourceSkillText {
  const key = `${nodeId}:${skillId}`;
  const translated = localizedMapText(SKILL_TEXT, key, locale);
  if (!translated) return text;

  const source = DEFAULT_SKILL_TEXT.get(key);
  return {
    label: builtInText(text.label, source?.label, translated.label),
    summary: builtInText(text.summary, source?.summary, translated.summary),
    prompt: builtInText(text.prompt, source?.prompt, translated.prompt),
  };
}

export function localizedGameExpertRootCommand(locale: Locale): string {
  if (locale === 'zh-CN') return '/游戏专家';
  if (locale === 'ja-JP') return '/ゲーム';
  if (locale === 'ko-KR') return '/게임';
  return '/game';
}
