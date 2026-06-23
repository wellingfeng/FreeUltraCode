import { beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import MessageContent from './MessageContent';
import { encodeToolPatch } from './lib/toolEvent';
import { MESSAGE_FILE_CHIP_LIMIT } from './lib/fileChipBudget';
import { useStore } from '@/store/useStore';

/**
 * Integration smoke test: render a representative AI message through the real
 * react-markdown + remark-gfm + rehype-highlight pipeline and assert the rich
 * output appears (highlighted code, GFM table, file chip, reasoning block).
 * Guards the load-bearing assumption that the pre/code overrides and language
 * detection work under react-markdown v9.
 */
describe('MessageContent integration', () => {
  beforeEach(() => {
    useStore.setState({ locale: 'zh-CN' });
  });

  const sample = [
    '# Heading',
    '',
    'Some **bold** prose with inline `src/store/useStore.ts:42` reference.',
    '',
    '```ts',
    'const x: number = 1;',
    'console.log(x);',
    '```',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    'A [link](https://example.com).',
  ].join('\n');

  it('preserves Windows clipboard-image paths through markdown so preview works', () => {
    // CommonMark would collapse the `\.ultragamestudio` escape and corrupt the path, leaving
    // the file chip pointing at a non-existent file (so clicking it cannot
    // preview). The protect pass keeps the original separators intact.
    const B = String.fromCharCode(92);
    const winPath = `E:${B}UltraGameStudio${B}.ultragamestudio${B}clipboard-images${B}pasted-1780825313768-e964bfa29a1d4c87-0.png`;
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text: `已保存截图 ${winPath} 完成。`,
        streaming: false,
        onOpenFile: () => {},
      }),
    );
    expect(html).toMatch(/ai-file-chip-thumb/);
    // The `.ultragamestudio` separator must survive: no `UltraGameStudio.ultragamestudio` collapse.
    expect(html).not.toMatch(/UltraGameStudio\.ultragamestudio/);
    expect(html).toMatch(/UltraGameStudio\\\.ultragamestudio\\clipboard-images/);
  });

  it('caps rendered local file references in one message', () => {
    const B = String.fromCharCode(92);
    const maxVisibleFileRefs = MESSAGE_FILE_CHIP_LIMIT;
    const paths = Array.from(
      { length: maxVisibleFileRefs + 4 },
      (_, i) =>
        `E:${B}UltraGameStudio${B}.ultragamestudio${B}clipboard-images${B}pasted-${i}.png`,
    ).join('\n');

    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text: `本地文件：\n${paths}`,
        streaming: false,
        onOpenFile: () => {},
      }),
    );

    expect(html.match(/ai-file-chip-thumb/g)).toHaveLength(maxVisibleFileRefs);
    expect(html.match(/ai-file-chip-limit/g)).toHaveLength(1);
    expect(html.match(/<br\/>/g)?.length ?? 0).toBeLessThanOrEqual(
      maxVisibleFileRefs + 2,
    );
    expect(html).toMatch(/已折叠后续文件引用|More file references folded/);
  });

  it('renders highlighted code, table, and file chip', () => {
    const html = renderToStaticMarkup(
      createElement(MessageContent, { text: sample, streaming: false }),
    );
    expect(html).toMatch(/hljs-/); // syntax highlighting applied
    expect(html).toMatch(/<table/); // GFM table
    expect(html).toMatch(/ai-file-chip/); // inline file reference became a chip
    expect(html).not.toMatch(/ai-file-chip--interactive/); // no preview handler wired
    expect(html).toMatch(/JetBrains|ai-code/); // code block chrome rendered
    expect(html).toMatch(/example\.com/); // external link survived
    expect(html).toMatch(/Heading/);
  });

  it('renders HLSL fences with syntax highlighting', () => {
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text: [
          '```hlsl',
          'float Dist = DistanceToNearestSurface(WorldPosition + Normal * Bias);',
          'float Mask = 1 - saturate(Dist / BlendWidth);',
          'float3 Result = lerp(BaseMaterial, BlendMaterial, Mask);',
          '```',
        ].join('\n'),
        streaming: false,
      }),
    );

    expect(html).toMatch(/language-hlsl/);
    expect(html).toMatch(/hljs-type/);
    expect(html).toMatch(/hljs-built_in|hljs-title/);
  });

  it('renders loose diff code as one folded block instead of scattered markdown lists', () => {
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text: [
          '-        });',
          '-        controller.close();',
          '-      },',
          '+        await waitFor(',
          '+          () => expect(done).toBe(true),',
        ].join('\n'),
        streaming: false,
      }),
    );

    // One code block, recognized as a diff and folded behind a toggle (its body
    // is hidden until the user expands it) rather than parsed as markdown lists.
    expect(html.match(/class="ai-code group\/code/g)).toHaveLength(1);
    expect(html).toMatch(/ai-code__folded/);
    expect(html).not.toMatch(/controller\.close/);
    expect(html).not.toMatch(/<ul/);
  });

  it('unwraps markdown wrappers that contain nested fenced code', () => {
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text: [
          '```markdown',
          '```ts',
          'const a = 1;',
          '```',
          '',
          '```css',
          '.a { color: red; }',
          '```',
          '```',
        ].join('\n'),
        streaming: false,
      }),
    );

    expect(html.match(/class="ai-code group\/code/g)).toHaveLength(2);
    expect(html).toMatch(/language-ts/);
    expect(html).toMatch(/language-css/);
  });

  it('renders a reasoning block separately from the answer', () => {
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text: '<think>let me plan</think>The final answer.',
        streaming: false,
      }),
    );
    expect(html).toMatch(/ai-reasoning/);
    expect(html).toMatch(/let me plan/);
    expect(html).toMatch(/The final answer/);
  });

  it('does not emit raw html (no rehype-raw)', () => {
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text: 'before <img src=x onerror=alert(1)> after',
        streaming: false,
      }),
    );
    // The raw <img> must be escaped/stripped, not rendered as a live element.
    expect(html).not.toMatch(/<img[^>]*onerror/);
  });

  it('renders generated image markdown with data URLs in the chat stream', () => {
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text:
          '✓ 图片生成完成\n\n' +
          '![生成图片 1](data:image/png;base64,iVBORw0KGgo=)',
        streaming: false,
      }),
    );

    expect(html).toMatch(/<img/);
    expect(html).toMatch(/class="ai-generated-image"/);
    expect(html).toMatch(/data:image\/png;base64,iVBORw0KGgo=/);
  });

  it('renders generated audio markdown with playback controls', () => {
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text:
          '✓ 音乐生成完成\n\n' +
          '[播放音频 1](https://example.com/generated.mp3)',
        streaming: false,
      }),
    );

    expect(html).toMatch(/ai-audio-player/);
    expect(html).toMatch(/播放音频 1/);
    expect(html).toMatch(/aria-label="(?:播放|Play)"/);
    expect(html).toMatch(/aria-label="(?:快进 10 秒|Forward 10s)"/);
    expect(html).toMatch(/aria-label="(?:结束|End)"/);
    expect(html).toMatch(/aria-label="(?:播放进度|Playback progress)"/);
  });

  it('renders generated 3D model links as inline viewports', () => {
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text:
          '✓ 3D 模型生成完成\n\n' +
          '[预览 3D 模型 1](https://example.com/generated.glb)',
        streaming: false,
      }),
    );

    expect(html).toMatch(/ai-model-viewer/);
    expect(html).toMatch(/3D 模型视口/);
    expect(html).toMatch(/重置视角/);
    expect(html).toMatch(/正在加载模型/);
  });

  it('keeps generated 3D data URLs through markdown sanitization', () => {
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text: '[预览 3D 模型 1](data:model/gltf-binary;base64,AAAA)',
        streaming: false,
      }),
    );

    expect(html).toMatch(/ai-model-viewer/);
    expect(html).toMatch(/data:model\/gltf-binary;base64,AAAA/);
  });

  it('renders signed 3D asset URLs as viewports when the label names a model', () => {
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text: '[预览 3D 模型 1](https://cdn.example.com/assets/abc123?token=xyz)',
        streaming: false,
      }),
    );

    expect(html).toMatch(/ai-model-viewer/);
    expect(html).toMatch(/abc123\?token=xyz/);
  });

  it('renders ordinary docs links as links when class names contain obj/model fragments', () => {
    const url =
      'https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/SubobjectDataSubsystem';
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text: `[${url}](${url})`,
        streaming: false,
      }),
    );

    expect(html).not.toMatch(/ai-model-viewer/);
    expect(html).toMatch(/dev\.epicgames\.com/);
  });

  it('does not render explicit image URLs as 3D viewports just because the label names a model', () => {
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text: '[预览 3D 模型 6](https://assets.meshy.ai/tasks/output/preview.png?token=xyz)',
        streaming: false,
      }),
    );

    expect(html).not.toMatch(/ai-model-viewer/);
    expect(html).toMatch(/preview\.png\?token=xyz/);
  });

  it('renders downloaded local 3D model links as viewports', () => {
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text: '[预览 3D 模型 1](file:///E:/UltraGameStudio/.ultragamestudio/model-assets/model.glb)',
        streaming: false,
      }),
    );

    expect(html).toMatch(/ai-model-viewer/);
    expect(html).toMatch(/model-assets/);
    expect(html).not.toMatch(/ai-file-chip/);
  });

  it('falls back to a normal link for unsupported remote 3D model formats', () => {
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text: '[预览 3D 模型 5](https://assets.example.com/model.usdz)',
        streaming: false,
      }),
    );

    expect(html).not.toMatch(/ai-model-viewer/);
    expect(html).not.toMatch(/当前格式暂不支持内嵌预览/);
    expect(html).toMatch(/https:\/\/assets\.example\.com\/model\.usdz/);
  });

  it('falls back to a file chip for unsupported local 3D model formats', () => {
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text: '[预览 3D 模型 5](file:///E:/UltraGameStudio/.ultragamestudio/model-assets/model.zip)',
        streaming: false,
        onOpenFile: () => {},
      }),
    );

    expect(html).not.toMatch(/ai-model-viewer/);
    expect(html).not.toMatch(/当前格式暂不支持内嵌预览/);
    expect(html).toMatch(/ai-file-chip--interactive/);
    expect(html).toMatch(/model-assets/);
  });

  it('renders requested default 3D animation controls in model previews', () => {
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text:
          '✓ 3D 模型生成完成\n' +
          '骨骼：已按可绑骨资产请求骨骼绑定和 Idle、Walk、Run 预览动画\n\n' +
          '[预览 3D 模型 1](file:///E:/UltraGameStudio/.ultragamestudio/model-assets/model.glb)',
      }),
    );

    expect(html).toMatch(/aria-label="播放动画 Idle"/);
    expect(html).toMatch(/aria-label="播放动画 Walk"/);
    expect(html).toMatch(/aria-label="播放动画 Run"/);
  });

  it('renders sandbox markdown links with unicode local filenames as file chips', () => {
    const name = 'Moon亮晶分析和渲染整体架构.html';
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text: `[${name}](sandbox:/mnt/data/${name})`,
        streaming: false,
        onOpenFile: () => {},
      }),
    );
    expect(html).toMatch(/ai-file-chip/);
    expect(html).toMatch(/ai-file-chip--interactive/);
    expect(html).toMatch(/Moon亮晶分析/);
  });

  it('shows relative file references as full workspace paths when cwd is known', () => {
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text: 'Open `src/store/useStore.ts:42`.',
        streaming: false,
        cwd: 'E:\\UltraGameStudio',
        onOpenFile: () => {},
      }),
    );
    expect(html).toMatch(/E:\\UltraGameStudio\\src\\store\\useStore\.ts/);
    expect(html).toMatch(/:42/);
  });

  it('renders backticked Windows capture paths with spaces as interactive file chips', () => {
    const B = String.fromCharCode(92);
    const path = `E:${B}UltraGameStudio${B}.ultragamestudio${B}session-captures${B}session-2026-06-07-1432.png`;
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text: `保存到（点击路径可预览）：\n- \`${path}\``,
        streaming: false,
        onOpenFile: () => {},
      }),
    );

    expect(html).toMatch(/ai-file-chip-thumb/);
    expect(html).toMatch(/UltraGameStudio/);
    expect(html).toMatch(/session-captures/);
  });

  it('shows a reveal-in-folder menu for interactive file chips', async () => {
    const calls: Array<{ path: string; reveal?: boolean }> = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(MessageContent, {
            text: 'Open `src/store/useStore.ts:42`.',
            streaming: false,
            onOpenFile: (ref, intent) => {
              calls.push({ path: ref.path, reveal: intent?.reveal });
            },
          }),
        );
      });

      const chip = container.querySelector<HTMLButtonElement>('.ai-file-chip');
      expect(chip).not.toBeNull();
      await act(async () => {
        chip!.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 16,
            clientY: 18,
          }),
        );
      });

      const menuItem = container.querySelector<HTMLButtonElement>(
        '.ai-file-chip-menu [role="menuitem"]',
      );
      expect(menuItem?.textContent).toContain('在文件夹中显示');
      await act(async () => {
        menuItem!.dispatchEvent(
          new MouseEvent('pointerdown', { bubbles: true, cancelable: true }),
        );
      });
      expect(container.querySelector('.ai-file-chip-menu')).not.toBeNull();
      await act(async () => {
        menuItem!.click();
      });

      expect(calls).toEqual([{ path: 'src/store/useStore.ts', reveal: true }]);
      expect(container.querySelector('.ai-file-chip-menu')).toBeNull();
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('renders legacy command progress lines as isolated tool cards', () => {
    const command = [
      `"C:\\Program Files\\PowerShell\\7\\pwsh.exe"`,
      `-Command`,
      `'p="""C:\\Users\\fengwei\\AppData\\Local\\npm-cache\\abc\\node_modules\\@larksuiteoapi\\lark-mcp\\dist\\mcp-tool\\tools\\zh"""; node "$p"'`,
    ].join(' ');
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text: `图片还在。\n🔧 command_execution: ${command}\n继续检查。`,
        streaming: false,
      }),
    );
    expect(html).toMatch(/ai-tool-card/);
    expect(html).toMatch(/command_execution/);
    expect(html).toMatch(/p=&quot;&quot;&quot;C:\\Users/);
    expect(html).not.toMatch(/ai-file-chip/);
    expect(html).not.toMatch(/Program Files/);
  });

  it('extracts inline legacy command progress from prose paragraphs', () => {
    const command = [
      `"C:\\Program Files\\PowerShell\\7\\pwsh.exe"`,
      `-Command`,
      `'p="""C:\\Users\\fengwei\\AppData\\Local\\npm-cache\\abc\\node_modules\\@larksuiteoapi\\lark-mcp\\dist\\mcp-tool\\tools\\zh"""; node "$p"'`,
    ].join(' ');
    const html = renderToStaticMarkup(
      createElement(MessageContent, {
        text:
          `先替一张表。 🔧 command_execution: ${command} ` +
          `🔧 command_execution: rg -n replace_image docx_image\\upload_all\\media.xupload node_modules 继续检查。`,
        streaming: false,
      }),
    );
    expect(html.match(/ai-tool-card/g)).toHaveLength(2);
    expect(html).toMatch(/先替一张表/);
    expect(html).not.toMatch(/🔧/);
    expect(html).not.toMatch(/ai-file-chip/);
    expect(html).not.toMatch(/Program Files/);
  });

  it('renders structured tool output with rich code chrome', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const text =
      'running' +
      encodeToolPatch({
        id: 'tool-1',
        name: 'Read',
        subject: 'app/src/example.ts',
        args: { file_path: 'app/src/example.ts' },
        status: 'done',
        result: 'const answer: number = 42;\nconsole.log(answer);',
      });

    try {
      await act(async () => {
        root.render(createElement(MessageContent, { text, streaming: false }));
      });
      await act(async () => {
        container.querySelector<HTMLButtonElement>('.ai-tool-toggle')?.click();
      });

      expect(container.querySelector('.ai-tool-panel.ai-code')).not.toBeNull();
      expect(container.textContent).toContain('typescript');
      expect(container.textContent).toContain('json');
      expect(container.querySelector('.hljs-keyword')).not.toBeNull();
      expect(container.querySelector('.ai-tool-panel > pre')).toBeNull();
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});
