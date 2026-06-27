import { describe, expect, it } from 'vitest';
import {
  GAME_TEMPLATE_PROFILES,
  STARTER_GAME_TEMPLATE_PROFILE_IDS,
  formatGameTemplateCatalogForPrompt,
  gameTemplateProfileById,
} from './gameTemplateProfiles';

describe('game template profiles', () => {
  it('registers 30 mainstream template profiles with stable ids', () => {
    expect(GAME_TEMPLATE_PROFILES).toHaveLength(30);
    const ids = GAME_TEMPLATE_PROFILES.map((profile) => profile.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 5)).toEqual([
      'platformer',
      'top_down',
      'grid_logic',
      'tower_defense',
      'ui_heavy',
    ]);
    expect(ids).toContain('fps');
    expect(ids).toContain('third_person_action');
    expect(ids).toContain('space_flight_vehicle_sim');
  });

  it('keeps each profile usable as a GDD and browser-verification contract', () => {
    for (const profile of GAME_TEMPLATE_PROFILES) {
      expect(profile.labelZh).toBeTruthy();
      expect(profile.labelEn).toBeTruthy();
      expect(profile.engines.length).toBeGreaterThan(0);
      expect(profile.requiredGdd.length).toBeGreaterThan(0);
      expect(profile.coreSystems.length).toBeGreaterThan(0);
      expect(profile.assetSlots.length).toBeGreaterThan(0);
      expect(profile.codeHooks.length).toBeGreaterThan(0);
      expect(profile.browserAcceptance.length).toBeGreaterThan(0);
      expect(profile.engineAcceptance.length).toBeGreaterThan(0);
      expect(profile.limits.length).toBeGreaterThan(0);
    }
  });

  it('finds profiles case-insensitively and exposes starter ids', () => {
    expect(gameTemplateProfileById('  FPS  ')?.labelZh).toBe('第一人称射击');
    expect(gameTemplateProfileById('missing')).toBeNull();
    expect(STARTER_GAME_TEMPLATE_PROFILE_IDS).toContain('platformer');
    expect(STARTER_GAME_TEMPLATE_PROFILE_IDS).toContain('card_battler');
  });

  it('formats the registry for slash-command and GDD prompts', () => {
    const zh = formatGameTemplateCatalogForPrompt('zh-CN');
    expect(zh).toContain('30 个主流模板');
    expect(zh).toContain('platformer');
    expect(zh).toContain('fps');
    expect(zh).toContain('浏览器验收');

    const en = formatGameTemplateCatalogForPrompt('en-US');
    expect(en).toContain('30 mainstream templates');
    expect(en).toContain('Browser verification is mandatory');
  });
});
