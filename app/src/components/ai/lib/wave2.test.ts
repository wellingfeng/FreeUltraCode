import { describe, expect, it } from 'vitest';
import {
  encodeToolPatch,
  extractToolSentinels,
  mergeToolPatches,
  hasToolSentinel,
} from './toolEvent';
import { segmentMessage } from './segmenter';
import { normalizeMath } from './normalizeMath';
import { detectCallout, stripCalloutMarker } from './callout';
import { toolCategory, toolIconName } from './toolMeta';

describe('toolEvent sentinel codec', () => {
  it('round-trips a patch through encode/extract', () => {
    const block = encodeToolPatch({ id: 'a', name: 'Bash', status: 'running' });
    expect(hasToolSentinel(block)).toBe(true);
    const { text, patches } = extractToolSentinels(`before${block}after`);
    expect(text.replace(/\s/g, '')).toBe('beforeafter');
    expect(patches).toEqual([{ id: 'a', name: 'Bash', status: 'running' }]);
  });

  it('leaves an incomplete trailing sentinel in place', () => {
    const partial = 'text <<UGS_TOOL>>{"id":"x"';
    const { text, patches } = extractToolSentinels(partial);
    expect(patches).toEqual([]);
    expect(text).toContain('<<UGS_TOOL>>');
  });

  it('renders a half-streamed trailing sentinel as an in-progress patch', () => {
    // Mirrors the real bug: a tool whose args carry a large body streams the
    // opening `<<UGS_TOOL>>{…` long before its `<<UGS_TOOL_END>>` arrives. With
    // streamingTail it must surface as a running tool card, not raw JSON prose.
    const partial =
      'Writing the file.\n<<UGS_TOOL>>{"id":"t1","name":"Edit","subject":"SKILL.md","status":"running","args":{"file_path":"SKILL.md","new_string":"# Title\\nlots of stream';
    const { text, patches } = extractToolSentinels(partial, { streamingTail: true });
    expect(patches).toEqual([
      { id: 't1', name: 'Edit', status: 'running', subject: 'SKILL.md' },
    ]);
    expect(text).not.toContain('UGS_TOOL');
    expect(text).not.toContain('new_string');
    expect(text).toContain('Writing the file.');
  });

  it('infers name/subject for a half-streamed sentinel that lacks them yet', () => {
    // Some emitters put `args` first; before `name`/`subject` arrive we still
    // want a sensible card from whatever streamed.
    const partial =
      '<<UGS_TOOL>>{"args":{"file_path":"Config/Skills/SKILL.md","new_string":"big body that never closes';
    const { patches } = extractToolSentinels(partial, { streamingTail: true });
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({
      name: 'Edit',
      status: 'running',
      subject: 'Config/Skills/SKILL.md',
    });
  });

  it('ignores a field name that only appears inside the streaming body', () => {
    // A `"name"` substring inside the unterminated new_string body must not be
    // mistaken for the tool name.
    const partial =
      '<<UGS_TOOL>>{"id":"t2","new_string":"const \\"name\\": \\"trap\\" still streaming';
    const { patches } = extractToolSentinels(partial, { streamingTail: true });
    expect(patches[0]).toMatchObject({ id: 't2', name: 'Edit', status: 'running' });
  });

  it('does not treat a literal prose marker as a streaming tool card', () => {
    // The model explaining the protocol writes `<<UGS_TOOL>>` followed by prose,
    // not a JSON object — keep it verbatim even under streamingTail.
    const partial = 'The marker is <<UGS_TOOL>> and it opens a block.';
    const { text, patches } = extractToolSentinels(partial, { streamingTail: true });
    expect(patches).toEqual([]);
    expect(text).toContain('<<UGS_TOOL>>');
  });

  it('keeps the incomplete sentinel verbatim when not streaming', () => {
    // A final (non-streaming) render has no more chunks coming, so the old
    // verbatim behaviour stands — we don't fabricate a card that never closed.
    const partial = 'text <<UGS_TOOL>>{"id":"x","name":"Edit"';
    const { text, patches } = extractToolSentinels(partial);
    expect(patches).toEqual([]);
    expect(text).toContain('<<UGS_TOOL>>');
  });

  it('keeps a literal UGS_TOOL marker in prose instead of dropping it', () => {
    // The model wrote the token itself (e.g. explaining the protocol). Its body
    // isn't a valid patch, so it must survive as prose rather than be dropped.
    const { text, patches } = extractToolSentinels(
      '<<UGS_TOOL>>not json<<UGS_TOOL_END>>',
    );
    expect(patches).toEqual([]);
    expect(text).toContain('<<UGS_TOOL>>');
  });

  it('does not swallow real sentinels after a literal marker in prose', () => {
    // Regression: a literal `<<UGS_TOOL>>` written in the answer used to pair
    // with a genuine sentinel's `<<UGS_TOOL_END>>` downstream, treating the
    // whole span as one unparseable block — which JSON.parse dropped, silently
    // truncating the rendered message at the literal marker.
    const real = encodeToolPatch({ id: 'a', name: 'Bash', status: 'done' });
    const text = `prose mentioning <<UGS_TOOL>> then more prose${real}tail`;
    const { text: out, patches } = extractToolSentinels(text);
    expect(patches).toEqual([{ id: 'a', name: 'Bash', status: 'done' }]);
    expect(out).toContain('<<UGS_TOOL>>');
    expect(out).toContain('then more prose');
    expect(out).toContain('tail');
  });

  it('round-trips a result that contains the literal sentinel markers', () => {
    // Reading a file whose source mentions <<UGS_TOOL>> / <<UGS_TOOL_END>> must
    // not let those markers prematurely close the block and leak as prose.
    const result =
      'const OPEN = "<<UGS_TOOL>>";\nconst CLOSE = "<<UGS_TOOL_END>>";\n';
    const block = encodeToolPatch({ id: 'r', name: 'Read', status: 'done', result });
    const { text, patches } = extractToolSentinels(`before${block}after`);
    expect(text.replace(/\s/g, '')).toBe('beforeafter');
    expect(patches).toEqual([{ id: 'r', name: 'Read', status: 'done', result }]);
  });

  it('keeps a subject with sentinel markers from leaking', () => {
    const block = encodeToolPatch({
      id: 's',
      name: 'Grep',
      status: 'running',
      subject: '<<UGS_TOOL_END>>',
    });
    const { patches } = extractToolSentinels(block);
    expect(patches).toEqual([
      { id: 's', name: 'Grep', status: 'running', subject: '<<UGS_TOOL_END>>' },
    ]);
  });

  it('merges a running + done patch into one event by id', () => {
    const merged = mergeToolPatches([
      { id: 'a', name: 'Read', status: 'running', subject: 'x.ts' },
      { id: 'a', status: 'done', durationMs: 120, result: 'ok' },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'a',
      name: 'Read',
      status: 'done',
      durationMs: 120,
      result: 'ok',
      subject: 'x.ts',
    });
  });

  it('preserves first-seen order across ids', () => {
    const merged = mergeToolPatches([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'a', status: 'done' },
    ]);
    expect(merged.map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('segmentMessage tool segments', () => {
  it('splits a tool sentinel into a tools segment in order', () => {
    const text =
      'before' +
      encodeToolPatch({ id: 'a', name: 'Bash', status: 'running' }) +
      encodeToolPatch({ id: 'a', status: 'done', durationMs: 5 }) +
      'after';
    const segs = segmentMessage(text);
    expect(segs.map((s) => s.type)).toEqual(['answer', 'tools', 'answer']);
    const tools = segs.find((s) => s.type === 'tools');
    if (tools && tools.type === 'tools') {
      expect(tools.events).toHaveLength(1);
      expect(tools.events[0]).toMatchObject({ id: 'a', status: 'done', durationMs: 5 });
    }
  });

  it('interleaves reasoning, tools, and answer', () => {
    const text =
      '<think>plan</think>' +
      'doing' +
      encodeToolPatch({ id: 't1', name: 'Read', status: 'done' });
    const segs = segmentMessage(text);
    expect(segs.map((s) => s.type)).toEqual(['reasoning', 'answer', 'tools']);
  });

  it('renders a single card when prose sits between running and done', () => {
    const text =
      'start' +
      encodeToolPatch({ id: 'x', name: 'Bash', status: 'running' }) +
      'thinking about it' +
      encodeToolPatch({ id: 'x', status: 'done', durationMs: 9 }) +
      'finished';
    const segs = segmentMessage(text);
    // Exactly one tools segment with one event (no duplicate card).
    const toolsSegs = segs.filter((s) => s.type === 'tools');
    expect(toolsSegs).toHaveLength(1);
    if (toolsSegs[0].type === 'tools') {
      expect(toolsSegs[0].events).toHaveLength(1);
      expect(toolsSegs[0].events[0]).toMatchObject({ id: 'x', status: 'done', durationMs: 9 });
    }
  });

  it('renders a single card when reasoning sits between running and done', () => {
    const text =
      encodeToolPatch({ id: 'y', name: 'Bash', status: 'running' }) +
      '<think>analysing</think>' +
      encodeToolPatch({ id: 'y', status: 'done' });
    const segs = segmentMessage(text);
    expect(segs.filter((s) => s.type === 'tools')).toHaveLength(1);
  });

  it('collapses repeated runtime heartbeat patches into one running status card', () => {
    const text =
      encodeToolPatch({
        id: 'runtime-status-run1',
        name: '运行状态',
        subject: '仍在运行…（已 12s）',
        status: 'running',
        ephemeral: true,
      }) +
      encodeToolPatch({
        id: 'runtime-status-run1',
        name: '运行状态',
        subject: '仍在运行…（已 24s）',
        status: 'running',
        ephemeral: true,
      });
    const segs = segmentMessage(text, true);
    const tools = segs.filter((s) => s.type === 'tools');
    expect(tools).toHaveLength(1);
    if (tools[0].type === 'tools') {
      expect(tools[0].events).toHaveLength(1);
      expect(tools[0].events[0]).toMatchObject({
        id: 'runtime-status-run1',
        subject: '仍在运行…（已 24s）',
        status: 'running',
        ephemeral: true,
      });
    }
  });

  it('drops a stale runtime heartbeat once newer prose arrives', () => {
    const text =
      encodeToolPatch({
        id: 'runtime-status-run1',
        name: '运行状态',
        subject: '仍在运行…（已 12s）',
        status: 'running',
        ephemeral: true,
      }) +
      '结论：已经完成。';
    const segs = segmentMessage(text, true);
    expect(segs).toEqual([{ type: 'answer', text: '结论：已经完成。' }]);
  });

  it('moves runtime heartbeat display to the latest tail heartbeat', () => {
    const text =
      encodeToolPatch({
        id: 'runtime-status-run1',
        name: '运行状态',
        subject: '仍在运行…（已 12s）',
        status: 'running',
        ephemeral: true,
      }) +
      '已读取配置。' +
      encodeToolPatch({
        id: 'runtime-status-run1',
        name: '运行状态',
        subject: '仍在运行…（已 24s）',
        status: 'running',
        ephemeral: true,
      });
    const segs = segmentMessage(text, true);
    expect(segs.map((s) => s.type)).toEqual(['answer', 'tools']);
    expect(segs[0]).toEqual({ type: 'answer', text: '已读取配置。' });
    if (segs[1].type === 'tools') {
      expect(segs[1].events).toHaveLength(1);
      expect(segs[1].events[0]).toMatchObject({
        id: 'runtime-status-run1',
        subject: '仍在运行…（已 24s）',
        ephemeral: true,
      });
    }
  });

  it('keeps only the final tail heartbeat for legacy text heartbeats', () => {
    expect(
      segmentMessage(
        '⏳ 仍在运行…（已 12s）\n已读取配置。\n⏳ 仍在运行…（已 24s）',
        true,
      ),
    ).toEqual([
      { type: 'answer', text: '已读取配置。\n⏳ 仍在运行…（已 24s）' },
    ]);
    expect(
      segmentMessage('⏳ 仍在运行…（已 12s）\n结论：已经完成。', true),
    ).toEqual([{ type: 'answer', text: '结论：已经完成。' }]);
  });

  it('keeps a done status when a late running patch arrives (monotonic)', () => {
    const merged = mergeToolPatches([
      { id: 'a', name: 'X', status: 'done', durationMs: 5 },
      { id: 'a', status: 'running' },
    ]);
    expect(merged[0].status).toBe('done');
  });

  it('leaves plain text untouched (no tools)', () => {
    expect(segmentMessage('just prose')).toEqual([{ type: 'answer', text: 'just prose' }]);
  });

  it('shows a half-streamed trailing tool sentinel as a running card while live', () => {
    const text =
      'Writing the skill file.\n' +
      '<<UGS_TOOL>>{"id":"t9","name":"Edit","subject":"SKILL.md","status":"running","args":{"file_path":"SKILL.md","new_string":"# MoonCodeReview\\nlong body still streaming and never closed';
    const segs = segmentMessage(text, true);
    expect(segs.map((s) => s.type)).toEqual(['answer', 'tools']);
    const tools = segs.find((s) => s.type === 'tools');
    expect(tools && tools.type === 'tools' && tools.events[0]).toMatchObject({
      id: 't9',
      name: 'Edit',
      status: 'running',
      subject: 'SKILL.md',
    });
    for (const s of segs) {
      if (s.type === 'answer') expect(s.text).not.toContain('UGS_TOOL');
    }
  });

  it('does not fabricate a running card for a half sentinel on the final render', () => {
    const text =
      'done\n<<UGS_TOOL>>{"id":"t9","name":"Edit","args":{"new_string":"unterminated';
    const segs = segmentMessage(text, false);
    // Non-streaming: the incomplete marker stays as prose (no tools segment).
    expect(segs.some((s) => s.type === 'tools')).toBe(false);
  });

  it('does not leak prose when a tool result embeds sentinel markers', () => {
    // Mirrors the real bug: reading a source file that contains the literal
    // <<UGS_TOOL>> / <<UGS_TOOL_END>> strings used to truncate the JSON payload
    // and spill the file body into the answer with escaped \n / \t.
    const result =
      'export const TOOL_OPEN = "<<UGS_TOOL>>";\n' +
      'export const TOOL_CLOSE = "<<UGS_TOOL_END>>";\n';
    const text =
      'Let me read the file.' +
      encodeToolPatch({ id: 'a', name: 'Read', status: 'running', subject: 'toolEvent.ts' }) +
      encodeToolPatch({ id: 'a', status: 'done', durationMs: 12, result }) +
      'Here is what I found.';
    const segs = segmentMessage(text);
    expect(segs.map((s) => s.type)).toEqual(['answer', 'tools', 'answer']);
    const tools = segs.find((s) => s.type === 'tools');
    expect(tools && tools.type === 'tools' && tools.events[0].result).toBe(result);
    // No raw sentinel marker or escaped file body bleeds into the answers.
    for (const s of segs) {
      if (s.type === 'answer') {
        expect(s.text).not.toContain('UGS_TOOL');
        expect(s.text).not.toContain('TOOL_OPEN');
      }
    }
  });
});

describe('normalizeMath', () => {
  it('rewrites \\( \\) to $ $', () => {
    expect(normalizeMath('a \\(x+1\\) b')).toBe('a $x+1$ b');
  });
  it('rewrites \\[ \\] to $$ $$', () => {
    expect(normalizeMath('\\[E=mc^2\\]')).toBe('$$E=mc^2$$');
  });
  it('leaves text without latex delimiters untouched', () => {
    expect(normalizeMath('no math here')).toBe('no math here');
  });
  it('escapes bare currency dollars so single-$ math does not eat prose', () => {
    expect(normalizeMath('I have $5 and $10 left')).toBe(
      'I have \\$5 and \\$10 left',
    );
  });
  it('does not escape a $ that is not followed by a digit', () => {
    expect(normalizeMath('cost is $x dollars')).toBe('cost is $x dollars');
  });
  it('does not rewrite inside inline code', () => {
    expect(normalizeMath('`\\(x\\)`')).toBe('`\\(x\\)`');
  });
});

describe('callout detection', () => {
  it('detects [!NOTE]', () => {
    expect(detectCallout('[!NOTE] hello')).toBe('note');
    expect(detectCallout('[!warning] x')).toBe('warning');
    expect(detectCallout('just text')).toBeNull();
  });
  it('strips the marker', () => {
    expect(stripCalloutMarker('[!TIP] body')).toBe('body');
  });
});

describe('toolMeta', () => {
  it('categorises common tools', () => {
    expect(toolCategory('edit_file')).toBe('write');
    expect(toolCategory('read_file')).toBe('read');
    expect(toolCategory('Bash')).toBe('exec');
    expect(toolCategory('grep')).toBe('search');
    expect(toolCategory('command_execution')).toBe('exec');
    expect(toolCategory('file_change')).toBe('write');
    expect(toolCategory('free_proxy')).toBe('web');
    expect(toolCategory('mystery')).toBe('other');
  });
  it('maps to icons', () => {
    expect(toolIconName('Bash')).toBe('SquareTerminal');
    expect(toolIconName('free_proxy')).toBe('Globe');
    expect(toolIconName('unknown')).toBe('Wrench');
  });
});
