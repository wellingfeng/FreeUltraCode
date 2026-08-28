import { describe, expect, it, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import MessageContent from './MessageContent';
import { unwrapMarkdownWrapper, fenceBareSvgBlocks } from './lib/repairMarkdown';
import { useStore } from '@/store/useStore';

describe('Markdown 渲染修复（```markdown 解包 + 无语言 fence 高亮）', () => {
  beforeEach(() => {
    useStore.setState({ locale: 'zh-CN' });
  });

  it('解包 ```markdown 包裹的裸 HTML/SVG 并交给 ```html 高亮', () => {
    const text = [
      '```markdown',
      '<!DOCTYPE html>',
      '<html lang="zh-CN">',
      '<head>',
      '  <meta charset="UTF-8">',
      '  <title>测试</title>',
      '</head>',
      '<body>',
      '  <div class="app">Hello</div>',
      '</body>',
      '</html>',
      '```',
    ].join('\n');
    const html = renderToStaticMarkup(
      createElement(MessageContent, { text, streaming: false }),
    );
    // unwrap 之后应该是 ```html 围栏 → RawCodeBlock → hljs language-xml/html
    expect(html).toMatch(/hljs/);
    expect(html).toMatch(/language-(?:xml|html)/);
    // 不应该出现 ```markdown 字样的代码块
    expect(html).not.toMatch(/language-markdown/);
  });

  it('解包 ```markdown 包裹的裸 SVG', () => {
    // 仅验证 unwrap + 重新包 fence 的转换结果，不走完整 SvgBlock 渲染（sanitizeSvg 在测试环境受限）
    const text = [
      '```markdown',
      '<svg viewBox="0 0 100 100">',
      '  <circle cx="50" cy="50" r="40" fill="red"/>',
      '  <rect x="10" y="10" width="80" height="80" fill="blue"/>',
      '  <text x="50" y="50">测试</text>',
      '</svg>',
      '```',
    ].join('\n');
    // 用 unwrapMarkdownWrapper 直接验证
    const unwrapped = unwrapMarkdownWrapper(text);
    expect(unwrapped).toMatch(/```svg/);
    expect(unwrapped).toMatch(/<svg viewBox/);
    expect(unwrapped).not.toMatch(/```markdown/);
  });

  it('顶层裸 SVG（无任何围栏）自动包成 ```svg 围栏', () => {
    const text = [
      '这是说明文字。',
      '',
      '<svg viewBox="0 0 100 100">',
      '  <circle cx="50" cy="50" r="40" fill="red"/>',
      '  <rect x="10" y="10" width="80" height="80" fill="blue"/>',
      '</svg>',
    ].join('\n');
    const out = fenceBareSvgBlocks(text);
    expect(out).toMatch(/```svg/);
    expect(out).toContain('<svg viewBox="0 0 100 100">');
    // 说明文字原样保留，不被吞进围栏
    expect(out.indexOf('这是说明文字。')).toBeLessThan(out.indexOf('```svg'));
  });

  it('单行裸 SVG 也能包成 ```svg 围栏', () => {
    const text = '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
    expect(fenceBareSvgBlocks(text)).toBe('```svg\n' + text + '\n```');
  });

  it('裸 SVG 前有同行说明文字也能包成 ```svg 围栏', () => {
    const text = '这是示意图：<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
    const out = fenceBareSvgBlocks(text);
    // 说明文字保留，`<svg` 与说明文字之间补换行，保证 fence 在行首被识别。
    expect(out).toMatch(/这是示意图：\n```svg\n/);
    expect(out).toContain('<svg viewBox="0 0 10 10">');
    expect(out.endsWith('```')).toBe(true);
  });

  it('未闭合的半截 SVG 保持原样，不包围栏', () => {
    const text = '<svg viewBox="0 0 100 100">\n  <circle cx="50" cy="50" r="40"/>\n';
    expect(fenceBareSvgBlocks(text)).toBe(text);
  });

  it('```svg 围栏内的内容不被二次包裹', () => {
    const text = [
      '```svg',
      '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
      '```',
    ].join('\n');
    expect(fenceBareSvgBlocks(text)).toBe(text);
  });

  it('无语言 fence 包 C++ 单行代码 → 触发 auto-detect 高亮', () => {
    const text = [
      '**tick 时间驱动**：',
      '',
      '```',
      'FillHourLighting(0.016);',
      'UpdateSunPosition(Hour);',
      'ApplyMaterialToMesh(DynamicMaterial);',
      '```',
    ].join('\n');
    const html = renderToStaticMarkup(
      createElement(MessageContent, { text, streaming: false }),
    );
    // 不应渲染成 ai-plain-block
    expect(html).not.toMatch(/ai-plain-block/);
    // 应该渲染成 RawCodeBlock（ai-code）
    expect(html).toMatch(/ai-code/);
    // hljs 已应用（auto-detect 到 cpp/c）
    expect(html).toMatch(/hljs/);
  });

  it('无语言 fence 包中文叙述 → 仍走 PlainTextBlock 不高亮', () => {
    const text = [
      '```',
      '这是一段中文说明，描述渲染管线的工作原理。',
      '第一段讲天空大气，第二段讲水面反射。',
      '完全没有代码特征，不应该被识别成代码。',
      '```',
    ].join('\n');
    const html = renderToStaticMarkup(
      createElement(MessageContent, { text, streaming: false }),
    );
    expect(html).toMatch(/ai-plain-block/);
  });

  it('PowerShell 长单行命令默认不做视觉折行', () => {
    const text = [
      '```powershell',
      "& { $env:CLAUDE_CODE_SSE_PORT=28537; $env:CLAUDE_CODE_ENTRYPOINT='cli'; claude code cli --dangerously-skip-permissions --model 'kimi-k3' '--output-format' 'stream-json' }",
      '```',
    ].join('\n');
    const html = renderToStaticMarkup(
      createElement(MessageContent, { text, streaming: false }),
    );

    expect(html).toMatch(/language-powershell/);
    expect(html).toMatch(/white-space:pre/);
    expect(html).not.toMatch(/ai-code--wrap/);
  });

  it('ASCII 框线 bare fence 仍走 PlainTextBlock（regression guard）', () => {
    const text = [
      '```',
      '时间轴 ────────────────────────────────────────────────────────▶',
      '',
      '[Unknown]',
      '    │  第一次转换',
      '    ▼',
      'CopyDest ◀── 拷贝目标',
      '```',
    ].join('\n');
    const html = renderToStaticMarkup(
      createElement(MessageContent, { text, streaming: false }),
    );
    expect(html).toMatch(/ai-plain-block/);
    expect(html).not.toMatch(/hljs-(?!plain)/);
  });
});
