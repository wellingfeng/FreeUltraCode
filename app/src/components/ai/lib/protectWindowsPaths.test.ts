import { describe, it, expect } from 'vitest';
import { protectWindowsPaths } from './protectWindowsPaths';

// Build backslash-bearing strings without fighting source-escaping noise.
const B = String.fromCharCode(92);
const winPath = `E:${B}UltraGameStudio${B}.ultragamestudio${B}clipboard-images${B}shot.png`;

describe('protectWindowsPaths', () => {
  it('returns input unchanged when there is no backslash', () => {
    const md = 'see .ultragamestudio/clipboard-images/shot.png here';
    expect(protectWindowsPaths(md)).toBe(md);
  });

  it('doubles backslashes in a drive-letter path so CommonMark restores them', () => {
    const out = protectWindowsPaths(`see ${winPath} here`);
    // every single backslash should now be a pair
    expect(out).toBe(`see ${winPath.replace(/\\/g, '\\\\')} here`);
    // and CommonMark's escape collapse (modelled as \\ -> \) brings it back
    expect(out.replace(/\\\\/g, '\\')).toContain(winPath);
  });

  it('protects UNC paths', () => {
    const unc = `${B}${B}server${B}share${B}file.png`;
    const out = protectWindowsPaths(`open ${unc} now`);
    expect(out.replace(/\\\\/g, '\\')).toContain(unc);
  });

  it('leaves backslashes inside fenced code untouched', () => {
    const md = ['```', winPath, '```'].join('\n');
    expect(protectWindowsPaths(md)).toBe(md);
  });

  it('leaves backslashes inside inline code untouched', () => {
    const md = `run \`${winPath}\` now`;
    expect(protectWindowsPaths(md)).toBe(md);
  });

  it('protects a path token that ends a sentence with .ultragamestudio segment', () => {
    const out = protectWindowsPaths(`图片 ${winPath} 完成`);
    expect(out.replace(/\\\\/g, '\\')).toContain(winPath);
  });

  // Regression: MARK was once silently stripped to '' , which made the restore
  // regex match bare digits in prose — stashed code content got swapped into
  // them, and stashed spans degraded to bare digits.
  it('keeps prose digits intact when inline code is stashed (empty-MARK regression)', () => {
    const md = `步骤 1 完成，见 \`${winPath}\`，共 2 处改动`;
    const out = protectWindowsPaths(md);
    // prose digits survive verbatim
    expect(out).toContain('步骤 1 完成');
    expect(out).toContain('共 2 处改动');
    // the code span is restored around its doubled-backslash content
    expect(out.replace(/\\\\/g, '\\')).toBe(md);
  });

  it('keeps prose digits intact when a fenced block is stashed (empty-MARK regression)', () => {
    const md = ['版本 3 的配置：', '```', winPath, '```', '第 4 行说明'].join('\n');
    const out = protectWindowsPaths(md);
    expect(out).toContain('版本 3 的配置：');
    expect(out).toContain('第 4 行说明');
    expect(out.replace(/\\\\/g, '\\')).toBe(md);
  });

  it('keeps Windows paths inside stashed code spans un-doubled (no cross-contamination)', () => {
    const md = `第 0 项 \`${winPath}\` 保持原样`;
    expect(protectWindowsPaths(md)).toBe(md);
  });
});
