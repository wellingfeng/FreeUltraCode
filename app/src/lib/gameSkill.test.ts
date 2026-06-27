import { describe, expect, it } from 'vitest';
import { GameSkill, ModeStartSkill, ModeEndSkill } from './gameSkill';
import { GAME_SKILLS } from './gameSkillRegistry';

describe('GameSkill base class', () => {
  it('projects to the runtime slash-command data shape', () => {
    const skill = new GameSkill({
      name: '/demo',
      category: 'orchestration',
      label: { 'zh-CN': '演示', 'en-US': 'Demo' },
      detail: { 'zh-CN': '细节', 'en-US': 'detail' },
      insertText: { 'zh-CN': '/demo ', 'en-US': '/demo ' },
      protocol: {
        triggers: '/demo',
        allowedTools: 'Read',
        steps: ['一步'],
        outputFormat: '结果',
        stopConditions: '完成即停',
        verification: '校验',
      },
    });
    expect(skill.toCommand()).toEqual({
      name: '/demo',
      label: { 'zh-CN': '演示', 'en-US': 'Demo' },
      detail: { 'zh-CN': '细节', 'en-US': 'detail' },
      text: { 'zh-CN': '/demo ', 'en-US': '/demo ' },
    });
  });

  it('defaults insertText to empty when omitted', () => {
    const skill = new GameSkill({
      name: '/x',
      category: 'session',
      label: { 'en-US': 'X' },
      detail: { 'en-US': 'x' },
      protocol: {
        triggers: 't',
        allowedTools: 'a',
        steps: ['s'],
        outputFormat: 'o',
        stopConditions: 'c',
        verification: 'v',
      },
    });
    expect(skill.toCommand().text).toEqual({ 'zh-CN': '', 'en-US': '' });
  });
});

describe('ModeStartSkill / ModeEndSkill', () => {
  it('appends the mode-on suffix to start verification', () => {
    const start = new ModeStartSkill({
      name: '/foo-mode-start',
      category: 'image',
      label: { 'en-US': 'Start Foo' },
      detail: { 'en-US': 'enter foo' },
      protocol: {
        triggers: '/foo-mode-start',
        allowedTools: 'channel',
        steps: ['do foo'],
        outputFormat: 'foo output',
        stopConditions: 'foo done',
        verification: '产物为 foo',
      },
    });
    expect(start.protocol.verification).toBe('产物为 foo；模式已置为开启。');
    expect(start.toCommand().text).toEqual({ 'zh-CN': '', 'en-US': '' });
  });

  it('derives the full six-part protocol for mode-end from the mode name', () => {
    const end = new ModeEndSkill({
      name: '/foo-mode-end',
      category: 'image',
      modeNameZh: 'Foo 模式',
      label: { 'en-US': 'End Foo' },
      detail: { 'en-US': 'leave foo' },
    });
    expect(end.protocol.triggers).toContain('/foo-mode-end');
    expect(end.protocol.triggers).toContain('退出Foo 模式');
    expect(end.protocol.allowedTools).toBe('无（仅切换模式状态）');
    expect(end.protocol.steps[0]).toContain('Foo 模式');
    expect(end.protocol.stopConditions).toBe('模式关闭即结束。');
    expect(end.protocol.verification).toContain('模式状态为关闭');
  });
});

describe('GAME_SKILLS registry', () => {
  it('is the single source of truth: every entry is a GameSkill with all six protocol parts', () => {
    expect(GAME_SKILLS.length).toBeGreaterThan(0);
    for (const skill of GAME_SKILLS) {
      expect(skill).toBeInstanceOf(GameSkill);
      const p = skill.protocol;
      expect(p.triggers.trim().length).toBeGreaterThan(0);
      expect(p.allowedTools.trim().length).toBeGreaterThan(0);
      expect(p.steps.length).toBeGreaterThan(0);
      expect(p.outputFormat.trim().length).toBeGreaterThan(0);
      expect(p.stopConditions.trim().length).toBeGreaterThan(0);
      expect(p.verification.trim().length).toBeGreaterThan(0);
      expect(skill.name.startsWith('/')).toBe(true);
    }
  });

  it('covers the 39 app-introduced commands and excludes generic shortcuts', () => {
    const names = GAME_SKILLS.map((s) => s.name);
    expect(names).toHaveLength(39);
    // Sample of each category is present.
    expect(names).toContain('/game');
    expect(names).toContain('/gdd-mode-start');
    expect(names).toContain('/gdd-mode-end');
    expect(names).toContain('/game-template-skill');
    expect(names).toContain('/game-debug-skill');
    expect(names).toContain('/game-verify-report');
    expect(names).toContain('/image-mode-start');
    expect(names).toContain('/image-mode-end');
    expect(names).toContain('/video-to-frames');
    expect(names).toContain('/metahuman-mode-end');
    expect(names).toContain('/screenshot-gif');
    // Generic shortcuts must NOT be GameSkills.
    for (const generic of ['/help', '/plan', '/diagnose', '/review', '/explain', '/test']) {
      expect(names).not.toContain(generic);
    }
  });

  it('has unique command names', () => {
    const names = GAME_SKILLS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
