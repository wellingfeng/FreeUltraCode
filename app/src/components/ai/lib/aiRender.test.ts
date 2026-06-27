import { describe, expect, it } from 'vitest';
import { segmentMessage, hasReasoning } from './segmenter';
import { parseFileRef, looksLikePath, displayFileRefPath } from './filePath';
import { scanFileRefs } from './fileScan';
import {
  fenceLooseDiffBlocks,
  repairMarkdown,
  repairFences,
  unwrapMarkdownWrapper,
} from './repairMarkdown';

describe('segmentMessage', () => {
  it('returns a single answer segment for plain text', () => {
    expect(segmentMessage('hello world')).toEqual([
      { type: 'answer', text: 'hello world' },
    ]);
  });

  it('splits a closed think block from the answer', () => {
    const out = segmentMessage('<think>plan it</think>final answer');
    expect(out).toEqual([
      { type: 'reasoning', text: 'plan it', done: true },
      { type: 'answer', text: 'final answer' },
    ]);
  });

  it('supports <thinking> alias and leading prose', () => {
    const out = segmentMessage('intro <thinking>why</thinking> done');
    expect(out).toEqual([
      { type: 'answer', text: 'intro ' },
      { type: 'reasoning', text: 'why', done: true },
      { type: 'answer', text: ' done' },
    ]);
  });

  it('marks an unclosed think as in-progress while streaming', () => {
    const out = segmentMessage('<think>still going', true);
    expect(out).toEqual([{ type: 'reasoning', text: 'still going', done: false }]);
  });

  it('marks an unclosed think as done on final render', () => {
    const out = segmentMessage('<think>done now', false);
    expect(out).toEqual([{ type: 'reasoning', text: 'done now', done: true }]);
  });

  it('holds back a partial closing tag while streaming', () => {
    const out = segmentMessage('<think>abc</thin', true);
    // The partial `</thin` must not leak into reasoning text.
    expect(out).toEqual([{ type: 'reasoning', text: 'abc', done: false }]);
  });

  it('interleaves multiple think/answer turns in order', () => {
    const out = segmentMessage('<think>a</think>A<think>b</think>B');
    expect(out).toEqual([
      { type: 'reasoning', text: 'a', done: true },
      { type: 'answer', text: 'A' },
      { type: 'reasoning', text: 'b', done: true },
      { type: 'answer', text: 'B' },
    ]);
  });

  it('hasReasoning detects tags', () => {
    expect(hasReasoning('no tags')).toBe(false);
    expect(hasReasoning('a <think>x')).toBe(true);
  });

  it('drops an empty closed reasoning block on final render', () => {
    expect(segmentMessage('<think></think>foo')).toEqual([
      { type: 'answer', text: 'foo' },
    ]);
  });

  it('does not leak a stray closing tag into the answer (nested)', () => {
    const out = segmentMessage('<think><think>x</think></think>ans');
    // No literal </think> should appear in any answer segment.
    const answer = out.find((s) => s.type === 'answer');
    expect(answer && 'text' in answer ? answer.text : '').not.toMatch(/<\/think/);
    expect(answer && 'text' in answer ? answer.text : '').toBe('ans');
  });
});

describe('parseFileRef', () => {
  it('parses path:line:col', () => {
    expect(parseFileRef('src/store/useStore.ts:42:7')).toEqual({
      path: 'src/store/useStore.ts',
      basename: 'useStore.ts',
      startLine: 42,
      col: 7,
    });
  });

  it('parses a bare path with extension', () => {
    expect(parseFileRef('config.ts')).toEqual({
      path: 'config.ts',
      basename: 'config.ts',
    });
  });

  it('parses @ file mentions as workspace-relative paths', () => {
    expect(parseFileRef('@src/App.tsx')).toEqual({
      path: 'src/App.tsx',
      basename: 'App.tsx',
    });
    expect(parseFileRef('@E:/ProjectMoon/MoonEngine/Engine/Runtime.cpp')).toEqual({
      path: 'E:/ProjectMoon/MoonEngine/Engine/Runtime.cpp',
      basename: 'Runtime.cpp',
    });
  });

  it('parses a line range', () => {
    const r = parseFileRef('file.ts:10-20');
    expect(r?.startLine).toBe(10);
    expect(r?.endLine).toBe(20);
    expect(r?.col).toBeUndefined();
  });

  it('parses #L anchors', () => {
    const r = parseFileRef('a/b.tsx#L5');
    expect(r?.path).toBe('a/b.tsx');
    expect(r?.startLine).toBe(5);
  });

  it('handles windows drive paths', () => {
    const r = parseFileRef('C:/Users/x/main.rs:12');
    expect(r?.path).toBe('C:/Users/x/main.rs');
    expect(r?.startLine).toBe(12);
  });

  it('rejects bare words and prose-y tokens', () => {
    expect(parseFileRef('config')).toBeNull();
    expect(parseFileRef('version')).toBeNull();
    expect(parseFileRef('16:9')).toBeNull();
  });

  it('rejects version numbers and dotted identifiers (no known extension)', () => {
    expect(parseFileRef('2.0')).toBeNull();
    expect(parseFileRef('v1.5.0')).toBeNull();
    expect(parseFileRef('version2.0')).toBeNull();
    expect(parseFileRef('react.useState')).toBeNull();
    expect(parseFileRef('2.5.3')).toBeNull();
    expect(looksLikePath('2.0')).toBe(false);
  });

  it('accepts dotted filenames with a known extension', () => {
    expect(parseFileRef('a.b.tsx')?.basename).toBe('a.b.tsx');
    expect(parseFileRef('vite.config.ts')?.basename).toBe('vite.config.ts');
  });

  it('accepts broader text/code/image extensions', () => {
    for (const name of [
      'schema.prisma',
      'main.tf',
      'shader.wgsl',
      'notes.adoc',
      'README.markdown',
      'report.qmd',
      'diagram.mmd',
      'workflow.drawio',
      'data.ndjson',
      'component.vue',
      'icon.avif',
      'favicon.ico',
    ]) {
      expect(parseFileRef(name)?.basename).toBe(name);
    }
  });

  it('accepts known extensionless config filenames', () => {
    for (const name of ['Dockerfile', 'Makefile', '.env.local', '.gitignore']) {
      expect(parseFileRef(name)?.basename).toBe(name);
    }
  });

  it('rejects an empty basename like a bare separator', () => {
    expect(parseFileRef('/')).toBeNull();
    expect(parseFileRef('//')).toBeNull();
  });

  it('rejects urls', () => {
    expect(parseFileRef('https://example.com/a.ts')).toBeNull();
    expect(looksLikePath('https://example.com')).toBe(false);
  });

  it('accepts local file urls', () => {
    expect(parseFileRef('file:///C:/Users/x/main.rs#L12')).toEqual({
      path: 'C:/Users/x/main.rs',
      basename: 'main.rs',
      startLine: 12,
    });
  });

  it('accepts explicit refs with spaces when requested', () => {
    expect(parseFileRef('Moon render report.html')).toBeNull();
    expect(
      parseFileRef('Moon render report.html', { allowSpaces: true })?.basename,
    ).toBe('Moon render report.html');
  });

  it('accepts relative path with separator and no extension', () => {
    expect(parseFileRef('./src/config')?.path).toBe('./src/config');
  });
});

describe('scanFileRefs (glued absolute paths)', () => {
  const BS = String.fromCharCode(92);
  const WIN = `E:${BS}UltraGameStudio${BS}.ultragamestudio${BS}clipboard-images${BS}shot.png`;

  // Pasting a clipboard image inserts a bare absolute path; when it lands right
  // after CJK prose with no separating space, the Unicode-aware run regex used
  // to swallow the prose into the path token, so the chip pointed at a bogus
  // `看图片E:\…` path (or vanished). The drive-letter anchor must split them.
  it('splits CJK prose glued onto a Windows absolute path', () => {
    const parts = scanFileRefs(`看这个图片${WIN}`);
    expect(parts[0]).toBe('看这个图片');
    expect(typeof parts[1] === 'object' && parts[1].path).toBe(WIN);
  });

  it('splits ascii prose glued onto a Windows absolute path', () => {
    const parts = scanFileRefs(`image${WIN}`);
    expect(parts[0]).toBe('image');
    expect(typeof parts[1] === 'object' && parts[1].basename).toBe('shot.png');
  });

  it('keeps a trailing :line suffix on a glued path', () => {
    const parts = scanFileRefs(`打开${WIN}:12 看看`);
    const ref = parts.find((p) => typeof p === 'object');
    expect(ref && typeof ref === 'object' && ref.startLine).toBe(12);
  });

  it('splits prose glued onto a UNC path', () => {
    const unc = `${BS}${BS}server${BS}share${BS}a.png`;
    const parts = scanFileRefs(`看${unc}`);
    expect(parts[0]).toBe('看');
    expect(typeof parts[1] === 'object' && parts[1].path).toBe(unc);
  });

  it('does not fragment urls whose scheme resembles a drive prefix', () => {
    expect(scanFileRefs('链接https://example.com/a.png')).toEqual([
      '链接https://example.com/a.png',
    ]);
    expect(scanFileRefs('the C: drive is full')).toEqual(['the C: drive is full']);
  });

  it('leaves a space-separated absolute path untouched', () => {
    const parts = scanFileRefs(`看这个图片 ${WIN}`);
    expect(parts[0]).toBe('看这个图片 ');
    expect(typeof parts[1] === 'object' && parts[1].path).toBe(WIN);
  });
});

describe('displayFileRefPath', () => {
  it('joins a relative path onto a real local cwd', () => {
    const ref = parseFileRef('src/store/useStore.ts')!;
    expect(displayFileRefPath(ref, '/home/u/proj')).toBe('/home/u/proj/src/store/useStore.ts');
  });

  it('does NOT join onto an opaque remote:// workspace root', () => {
    // A remote workspace cwd is the synthetic `remote://<id>` path. Joining a
    // relative chip path onto it fabricates an un-openable `remote://...` string
    // and corrupts non-path text (e.g. a regex) via separator normalization.
    const ref = parseFileRef('a/app/src-tauri/src/free_proxy.rs')!;
    expect(displayFileRefPath(ref, 'remote://rw_0ab2d791')).toBe(
      'a/app/src-tauri/src/free_proxy.rs',
    );
  });

  it('leaves an absolute path untouched regardless of cwd', () => {
    const ref = parseFileRef('C:/Users/x/main.rs')!;
    expect(displayFileRefPath(ref, '/home/u/proj')).toBe('C:/Users/x/main.rs');
  });
});

describe('repairMarkdown', () => {
  it('closes a dangling fence', () => {
    expect(repairMarkdown('```ts\nconst a = 1')).toBe('```ts\nconst a = 1\n```');
  });

  it('leaves balanced fences untouched', () => {
    const src = '```ts\nconst a = 1\n```';
    expect(repairMarkdown(src)).toBe(src);
  });

  it('closes a dangling inline tick', () => {
    expect(repairMarkdown('use `foo')).toBe('use `foo`');
  });

  it('ignores ticks inside a closed fence', () => {
    const src = '```\na ` b\n```';
    expect(repairMarkdown(src)).toBe(src);
  });
});

describe('unwrapMarkdownWrapper', () => {
  it('removes a whole-message markdown wrapper when it contains inner fences', () => {
    const src = [
      '```markdown',
      '说明',
      '',
      '```ts',
      'const a = 1;',
      '```',
      '```',
    ].join('\n');

    expect(unwrapMarkdownWrapper(src)).toBe(
      ['说明', '', '```ts', 'const a = 1;', '```'].join('\n'),
    );
  });

  it('keeps ordinary markdown fences as code', () => {
    const src = ['```markdown', '# Title', '```'].join('\n');
    expect(unwrapMarkdownWrapper(src)).toBe(src);
  });
});

describe('fenceLooseDiffBlocks', () => {
  it('wraps loose code-like diff lines so markdown does not parse them as lists', () => {
    const src = [
      '-        });',
      '-        controller.close();',
      '-      },',
      '+        await waitFor(',
      '+          () => expect(done).toBe(true),',
    ].join('\n');

    expect(fenceLooseDiffBlocks(src)).toBe(
      ['```diff', src, '```'].join('\n'),
    );
  });

  it('does not wrap normal prose lists', () => {
    const src = ['- item one', '- item two'].join('\n');
    expect(fenceLooseDiffBlocks(src)).toBe(src);
  });
});

describe('repairFences', () => {
  it('closes a dangling fence so it cannot swallow trailing prose', () => {
    expect(repairFences('```ts\nconst a = 1')).toBe('```ts\nconst a = 1\n```');
  });

  it('leaves balanced fences and inline ticks untouched', () => {
    const src = '```ts\nconst a = 1\n```\nuse `foo` here';
    expect(repairFences(src)).toBe(src);
  });

  it('does not append a stray inline backtick on final render', () => {
    // A finalized line that legitimately ends in a backtick must stay as-is.
    expect(repairFences('count is `n')).toBe('count is `n');
  });

  it('repairs whole-message markdown wrappers with nested fences', () => {
    const src = [
      '⚙ 路由：本地',
      '```markdown',
      '```ts',
      'const code = `value`;',
      '```',
      '```',
    ].join('\n');

    expect(repairFences(src)).toBe(
      ['⚙ 路由：本地', '```ts', 'const code = `value`;', '```'].join('\n'),
    );
  });
});
