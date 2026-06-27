import { describe, it, expect } from 'vitest';
import { sanitizeMermaid } from './sanitizeMermaid';

describe('sanitizeMermaid', () => {
  it('leaves non-flowchart diagrams unchanged', () => {
    const seq = ['sequenceDiagram', 'A->>B: hi'].join('\n');
    expect(sanitizeMermaid(seq)).toBe(seq);
  });

  it('quotes labels containing a colon', () => {
    const out = sanitizeMermaid('flowchart TD\n  A[采样: 权重] --> B[ok]');
    expect(out).toContain('A["采样: 权重"]');
    expect(out).toContain('B["ok"]');
  });

  it('escapes inner double quotes as #quot;', () => {
    const out = sanitizeMermaid('flowchart TD\n  A --> C[按"无遮挡贡献"抽样]');
    expect(out).toContain('C["按#quot;无遮挡贡献#quot;抽样"]');
  });

  it('does not double-wrap already-quoted labels', () => {
    const src = 'flowchart TD\n  A["已引用"] --> B[x]';
    const out = sanitizeMermaid(src);
    expect(out).toContain('A["已引用"]');
    expect(out).not.toContain('""');
  });

  it('handles compound shapes like ([...]) and {{...}}', () => {
    const out = sanitizeMermaid('flowchart LR\n  A([开始: x]) --> B{{判断/选择}}');
    expect(out).toContain('A(["开始: x"])');
    expect(out).toContain('B{{"判断/选择"}}');
  });

  it('leaves empty shape bodies alone', () => {
    const src = 'flowchart TD\n  A[] --> B';
    expect(sanitizeMermaid(src)).toBe(src);
  });
});
