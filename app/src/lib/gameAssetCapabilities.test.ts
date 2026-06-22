import { describe, expect, it } from 'vitest';
import {
  assertGameAssetCapabilityRegistryValid,
  defaultCapabilityIdsForRole,
  formatAssetRequestProtocolBlock,
  normalizeGameAssetCapabilityIds,
  routeAssetRequest,
} from './gameAssetCapabilities';

describe('game asset capabilities', () => {
  it('references only registered GameSkills', () => {
    expect(() => assertGameAssetCapabilityRegistryValid()).not.toThrow();
  });

  it('normalizes aliases used by role skill configuration', () => {
    expect(normalizeGameAssetCapabilityIds(['image', '3D', 'spritesheet', 'tts'])).toEqual([
      'image',
      'mesh',
      'sprite',
      'speech',
    ]);
  });

  it('derives default capabilities for functional roles and experts', () => {
    expect(defaultCapabilityIdsForRole('art-director')).toEqual(
      expect.arrayContaining(['image', 'sprite', 'mesh', 'ui']),
    );
    expect(defaultCapabilityIdsForRole('technical-artist')).toEqual(
      expect.arrayContaining(['mesh', 'sprite', 'image']),
    );
    expect(defaultCapabilityIdsForRole('audio-director')).toEqual(
      expect.arrayContaining(['music', 'speech']),
    );
  });

  it('formats the Asset Request routing protocol for role Skills', () => {
    const text = formatAssetRequestProtocolBlock(['image', 'sprite'], 'zh-CN');
    expect(text).toContain('Asset Request 字段');
    expect(text).toContain('/image');
    expect(text).toContain('/sprite');
  });

  it('routes concrete asset requests to the matching GameSkill command', () => {
    const route = routeAssetRequest({
      text: '生成角色四方向 idle 和 run spritesheet',
      roleLabel: '角色美术',
      capabilityIds: ['image', 'sprite', 'mesh'],
    });

    expect(route?.capability.id).toBe('sprite');
    expect(route?.commandText).toContain('/sprite');
    expect(route?.assetRequest).toContain('assetType: sprite');
  });
});
