import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { segmentMessage } from './segmenter';

describe('real stuck message', () => {
  it('segments', () => {
    const d = JSON.parse(readFileSync(
      'C:/Users/fengwei/.ultragamestudio/workspaces/eaf309452219f89c/sessions/778f310b-7b5a-4823-aa1f-322a99d3a53d.json',
      'utf-8',
    ));
    const text = d.messages[1].text;
    for (const streaming of [true, false]) {
      const segs = segmentMessage(text, streaming);
      const kinds: Record<string, number> = {};
      let toolEvents = 0;
      for (const s of segs) {
        kinds[s.type] = (kinds[s.type] ?? 0) + 1;
        if (s.type === 'tools') toolEvents += s.events.length;
      }
      console.log(`streaming=${streaming} segments=${segs.length}`, kinds, 'toolEvents=', toolEvents);
      // first 3 and last 3 segment types
      console.log('first:', segs.slice(0, 3).map((s) => s.type));
      console.log('last:', segs.slice(-3).map((s) => s.type));
    }
  });
});
