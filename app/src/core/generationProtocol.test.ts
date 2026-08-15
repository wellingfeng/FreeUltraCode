import { describe, expect, it } from 'vitest';
import {
  parseGenRequests,
  hasGenRequest,
  stripGenRequests,
  genInstruction,
  detectRequestedGenKinds,
  mergeGenKinds,
  GEN_OPEN,
  GEN_CLOSE,
} from './generationProtocol';

describe('generationProtocol', () => {
  it('parses a single image request', () => {
    const text = 'ok\n' + GEN_OPEN + '\n{"kind":"image","prompt":"a cat"}\n' + GEN_CLOSE + '\n';
    expect(parseGenRequests(text)).toEqual([{ kind: 'image', prompt: 'a cat' }]);
    expect(hasGenRequest(text)).toBe(true);
  });

  it('parses a batch of requests in order', () => {
    const text =
      GEN_OPEN + '{"kind":"image","prompt":"one"}' + GEN_CLOSE +
      ' mid ' +
      GEN_OPEN + '{"kind":"image","prompt":"two"}' + GEN_CLOSE;
    expect(parseGenRequests(text)).toEqual([
      { kind: 'image', prompt: 'one' },
      { kind: 'image', prompt: 'two' },
    ]);
  });

  it('normalizes kind aliases', () => {
    const mk = (k: string) => GEN_OPEN + '{"kind":"' + k + '","prompt":"x"}' + GEN_CLOSE;
    expect(parseGenRequests(mk('img'))[0].kind).toBe('image');
    expect(parseGenRequests(mk('3d'))[0].kind).toBe('threeD');
    expect(parseGenRequests(mk('anim'))[0].kind).toBe('animation');
    expect(parseGenRequests(mk('tts'))[0].kind).toBe('speech');
  });

  it('tolerates malformed sentinels', () => {
    const text = '<<UGS_GEN>{"kind":"image","prompt":"loose"}<< UGS_GEN_END >>>';
    expect(parseGenRequests(text)).toEqual([{ kind: 'image', prompt: 'loose' }]);
  });

  it('ignores an unterminated block', () => {
    const text = GEN_OPEN + '{"kind":"image","prompt":"no close"}';
    expect(parseGenRequests(text)).toEqual([]);
    expect(hasGenRequest(text)).toBe(false);
  });

  it('rejects unknown kind and empty prompt', () => {
    const bad1 = GEN_OPEN + '{"kind":"weapon","prompt":"x"}' + GEN_CLOSE;
    const bad2 = GEN_OPEN + '{"kind":"image","prompt":"  "}' + GEN_CLOSE;
    expect(parseGenRequests(bad1)).toEqual([]);
    expect(parseGenRequests(bad2)).toEqual([]);
  });

  it('strips every block from visible prose', () => {
    const text =
      '开始\n' + GEN_OPEN + '{"kind":"image","prompt":"a"}' + GEN_CLOSE + '\n中间\n' +
      GEN_OPEN + '{"kind":"music","prompt":"b"}' + GEN_CLOSE + '\n结束';
    const stripped = stripGenRequests(text);
    expect(stripped).not.toContain('UGS_GEN');
    expect(stripped).toContain('开始');
    expect(stripped).toContain('中间');
    expect(stripped).toContain('结束');
  });

  it('strips an unterminated trailing block', () => {
    const text = 'prose\n' + GEN_OPEN + '{"kind":"image","prompt":"x"}';
    expect(stripGenRequests(text)).toBe('prose');
  });

  it('genInstruction gates on authorized kinds', () => {
    expect(genInstruction([])).toBe('');
    const inst = genInstruction(['image', 'music']);
    expect(inst).toContain('图片');
    expect(inst).toContain('音乐');
    expect(inst).toContain(GEN_OPEN);
  });

  it('detects inline asset commands as an authorization signal', () => {
    expect(detectRequestedGenKinds('帮我配图，用 /image 出五张封面')).toEqual([
      'image',
    ]);
    expect(detectRequestedGenKinds('/video 做个片头 然后 /music 配乐')).toEqual([
      'music',
      'video',
    ]);
    expect(detectRequestedGenKinds('/生图 一只猫')).toEqual(['image']);
    expect(detectRequestedGenKinds('/mesh-mode-start 一把剑')).toEqual(['threeD']);
    expect(detectRequestedGenKinds('普通聊天没有命令')).toEqual([]);
    // A bare slash-less mention must not authorize anything.
    expect(detectRequestedGenKinds('讨论 image 生成规则')).toEqual([]);
  });

  it('merges sticky-mode and inline kinds without duplicates', () => {
    expect(mergeGenKinds(['image'], ['image', 'video'])).toEqual([
      'image',
      'video',
    ]);
    expect(mergeGenKinds([], ['music'])).toEqual(['music']);
    expect(mergeGenKinds(['sprite'], [])).toEqual(['sprite']);
  });
});
