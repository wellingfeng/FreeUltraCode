/**
 * CONTRACT: write-safety scan for long-term memory entries (mirrors Hermes'
 * memory-write security scan).
 *
 * Memory entries are injected verbatim into every future session's system
 * prompt, so a malicious or accidental "fact" is a PERSISTED prompt-injection
 * vector: one poisoned entry silently steers every later conversation. This
 * module scans candidate entry text BEFORE it lands in the store and reports
 * three classes of threat:
 *   1. injection   — instructions that try to override the assistant's rules
 *                    ("ignore previous instructions" and Chinese variants) or
 *                    exfiltrate the system prompt.
 *   2. credential  — API keys, bearer tokens, private keys, password assignments.
 *   3. invisible   — zero-width / bidi-control / invisible Unicode that could
 *                    smuggle hidden instructions past a human reviewer.
 *
 * It is deliberately mechanical (regex only, no model call): the scan runs on
 * every write path (foreground protocol, background review, manual refresh,
 * Settings panel) through the single choke point in lib/memoryStore.ts.
 * Findings REJECT the write — we never silently rewrite content.
 */

export type MemorySafetyFindingKind = 'injection' | 'credential' | 'invisible';

export interface MemorySafetyFinding {
  kind: MemorySafetyFindingKind;
  /** Short human-readable reason (shown in rejection errors / UI). */
  reason: string;
}

interface ScanRule {
  kind: MemorySafetyFindingKind;
  re: RegExp;
  reason: string;
}

// Order matters only for error-message readability; all matches are reported.
const RULES: ScanRule[] = [
  // --- prompt injection -------------------------------------------------------
  {
    kind: 'injection',
    re: /ignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts|rules)/i,
    reason: '覆盖指令类注入（ignore previous instructions）',
  },
  {
    kind: 'injection',
    re: /disregard\s+(?:all\s+)?(?:previous|prior|above|your)\s+(?:instructions|prompts|rules|system)/i,
    reason: '覆盖指令类注入（disregard …）',
  },
  {
    kind: 'injection',
    re: /(?:无视|忽略| disregard|disregards?|不管|不再遵守)[^\n。]{0,8}(?:你)?(?:之前|以上|上面|前面|先前|所有)(?:的)?(?:所有)?(?:指令|提示|规则|设定|要求|限制)/,
    reason: '覆盖指令类注入（无视/忽略以上指令）',
  },
  {
    kind: 'injection',
    re: /(?:\b(?:reveal|print|show|repeat|leak|expose|output|give\s+me|send\s+me)\b|输出|泄露|复述|打印|给出)[^\n。]{0,20}(?:(?:your|the|its|完整|全部)?\s*system\s*prompt|系统提示|系统指令|system\s*instructions)/i,
    reason: '系统提示泄露诱导',
  },
  {
    kind: 'injection',
    re: /you\s+are\s+now\s+(?:a|an|in)\s+(?:dan|developer\s+mode|jailbreak|unrestricted|unfiltered)/i,
    reason: '越狱角色扮演注入（DAN / unrestricted）',
  },
  {
    kind: 'injection',
    re: /(?:从现在开始|now on)[^\n。]{0,24}(?:不受(?:任何)?限制|没有(?:任何)?限制|无限制| unrestricted)/i,
    reason: '解除限制类注入',
  },
  // --- credentials ------------------------------------------------------------
  {
    kind: 'credential',
    re: /sk-ant-[A-Za-z0-9_-]{8,}/,
    reason: 'Anthropic API key',
  },
  {
    kind: 'credential',
    re: /\bsk-(?:proj-|svcacct-|[A-Za-z0-9]{20,})/,
    reason: 'OpenAI 风格 API key',
  },
  {
    kind: 'credential',
    re: /\bAKIA[0-9A-Z]{16}\b/,
    reason: 'AWS Access Key ID',
  },
  {
    kind: 'credential',
    re: /\bghp_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    reason: 'GitHub token',
  },
  {
    kind: 'credential',
    re: /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
    reason: 'Bearer token',
  },
  {
    kind: 'credential',
    re: /-----BEGIN\s+(?:[A-Z0-9]+\s+)*PRIVATE KEY-----/,
    reason: '私钥文本块',
  },
  {
    kind: 'credential',
    re: /\b(?:password|passwd|pwd|api[-_]?key|secret|token)\s*[:=]\s*['"]?[^\s'"]{6,}/i,
    reason: '疑似明文凭据赋值',
  },
];

// Invisible/ambiguous Unicode: zero-width (U+200B-200F), bidi controls
// (U+202A-202E), invisible operators/separators (U+2060-206F), BOM (U+FEFF),
// tag characters (U+E0000-E007F). Variation selectors stay OUT (emoji use
// them legitimately). Built from escapes so the source holds no literal
// invisible characters (project lint bans irregular whitespace).
const INVISIBLE_RE = new RegExp(
  '[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\uFEFF\\u{E0000}-\\u{E007F}]',
  'u',
);

/** Scan candidate memory text. Returns every finding (empty = safe). */
export function scanMemoryContent(text: string): MemorySafetyFinding[] {
  if (!text) return [];
  const findings: MemorySafetyFinding[] = [];
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (m) {
      findings.push({
        kind: rule.kind,
        reason: `${rule.reason}：「${m[0].slice(0, 24)}」`,
      });
    }
  }
  if (INVISIBLE_RE.test(text)) {
    findings.push({
      kind: 'invisible',
      reason: '含不可见/双向控制 Unicode 字符',
    });
  }
  return findings;
}

/** True when the text would be rejected by the write-path scan. */
export function isMemoryContentSafe(text: string): boolean {
  return scanMemoryContent(text).length === 0;
}
