import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path';

// Server-side scan of a project workspace for the slash command / skill catalog
// the client should surface for a remote project. This mirrors the desktop
// backend's local skill scan (app/src-tauri/src/lib.rs) but reads the *remote*
// project's checkout instead of the local machine, so the `/` menu reflects the
// skills the remote agent can actually run.
//
// Output entries are shaped to match the client SlashCatalogEntry contract
// (id/kind/name/label/detail/insertText/source/sourceAdapter) so they fold
// straight into buildSlashSuggestions on the client.

const MAX_ENTRIES = 400;
const MAX_COMMAND_DEPTH = 6;
const MAX_SKILL_DEPTH = 8;
const MAX_SKILL_FILE_BYTES = 512 * 1024;
const SKILL_SUMMARY_MAX_CHARS = 180;

const SKILL_SOURCES = [
  ['.claude', 'claude-code'],
  ['.codex', 'codex'],
  ['.gemini', 'gemini'],
  ['.agents', 'agent'],
];

const SKIP_DIRS = new Set([
  '.git',
  '.next',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
  'tests',
  'tmp',
]);

function isPathInside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function cleanFrontmatterValue(value) {
  return String(value ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

// Parse a SKILL.md / command .md frontmatter for `name` + `description`.
function parseSkillFrontmatter(text, fallbackName) {
  const normalized = text.replace(/^﻿/, '');
  let name = '';
  let description = '';
  const lines = normalized.split(/\r?\n/);

  if (lines[0]?.trim() === '---') {
    const yaml = [];
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].trim() === '---') break;
      yaml.push(lines[i]);
    }
    for (let i = 0; i < yaml.length; i += 1) {
      const trimmed = yaml[i].trim();
      if (trimmed.startsWith('name:')) {
        name = cleanFrontmatterValue(trimmed.slice('name:'.length));
      } else if (trimmed.startsWith('description:')) {
        const rest = cleanFrontmatterValue(trimmed.slice('description:'.length));
        if (rest === '>' || rest === '|' || rest === '>-' || rest === '|-') {
          const parts = [];
          i += 1;
          while (i < yaml.length) {
            const next = yaml[i];
            if (!/^\s/.test(next) && next.trim() !== '') {
              i -= 1;
              break;
            }
            const part = next.trim();
            if (part) parts.push(part);
            i += 1;
          }
          description = parts.join(' ');
        } else {
          description = rest;
        }
      }
    }
  }

  return {
    name: (name || fallbackName).trim(),
    description: description.trim(),
  };
}

function markdownSummary(text) {
  const normalized = text.replace(/^﻿/, '');
  const lines = normalized.split(/\r?\n/);
  let inFrontmatter = false;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (i === 0 && trimmed === '---') {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (trimmed === '---') inFrontmatter = false;
      continue;
    }
    if (!trimmed || trimmed.startsWith('<!--')) continue;
    const summary = trimmed
      .replace(/^#+/, '')
      .trim()
      .replace(/^>+/, '')
      .trim()
      .replace(/^`+|`+$/g, '')
      .trim();
    if (summary) {
      return summary.length > SKILL_SUMMARY_MAX_CHARS
        ? `${summary.slice(0, SKILL_SUMMARY_MAX_CHARS)}…`
        : summary;
    }
  }
  return '';
}

function slashToken(input, fallback) {
  const raw = `${input}`.trim().replace(/^\/+/, '');
  const base = raw || `${fallback}`.trim().replace(/^\/+/, '');
  const token = base
    .toLowerCase()
    .replace(/[^a-z0-9_\-¡-￿]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return token || 'skill';
}

function localizedText(zh, en) {
  return { 'zh-CN': zh, 'en-US': en };
}

function sameText(value) {
  return { 'zh-CN': value, 'en-US': value };
}

function skillEntryFromFile(text, skillDir, relSource, sourceAdapter) {
  const fallback = basename(skillDir);
  const { name, description } = parseSkillFrontmatter(text, fallback);
  const token = slashToken(name, fallback);
  const slashName = `/${token}`;
  const detail = description.trim() ? description : relSource;
  const zhInsert = description.trim()
    ? `请按 ${slashName} skill 的工作流处理当前请求。Skill 摘要：${description}`
    : `请按 ${slashName} skill 的工作流处理当前请求。`;
  const enInsert = description.trim()
    ? `Use the ${slashName} skill workflow for this request. Skill summary: ${description}`
    : `Use the ${slashName} skill workflow for this request.`;
  return {
    id: `skill:remote:${token}:${relSource}`,
    kind: 'skill',
    name: slashName,
    label: sameText(name),
    detail: sameText(detail),
    insertText: localizedText(zhInsert, enInsert),
    source: relSource,
    sourceAdapter,
  };
}

function commandNameFromRelative(relPath) {
  const withoutExt = relPath.slice(0, relPath.length - extname(relPath).length);
  const parts = withoutExt
    .split('/')
    .map((segment) => slashToken(segment, ''))
    .filter((segment) => segment && segment !== 'skill');
  if (parts.length === 0) return null;
  return `/${parts.join(':')}`;
}

function commandSourceLabel(sourceAdapter) {
  switch (sourceAdapter) {
    case 'claude-code':
      return ['Claude Code', 'Claude Code'];
    case 'codex':
      return ['Codex', 'Codex'];
    case 'gemini':
      return ['Gemini', 'Gemini'];
    case 'agent':
      return ['Agent', 'Agent'];
    default:
      return ['CLI', 'CLI'];
  }
}

function commandEntryFromFile(text, relPathFromCommandRoot, relSource, sourceAdapter) {
  const fallbackName = basename(relPathFromCommandRoot, extname(relPathFromCommandRoot));
  const { name: frontName, description } = parseSkillFrontmatter(text, fallbackName);
  const slashName = commandNameFromRelative(relPathFromCommandRoot);
  if (!slashName) return null;
  const summary = description.trim() || markdownSummary(text);
  const detail = summary.trim() || relSource;
  const [sourceZh, sourceEn] = commandSourceLabel(sourceAdapter);
  const label = frontName.trim() || fallbackName;
  const zhInsert = `按 ${sourceZh} 自定义 slash command \`${slashName}\` 的说明处理当前请求。命令说明：${detail}`;
  const enInsert = `Use the custom \`${slashName}\` slash-command instructions from ${sourceEn} CLI for this request. Command summary: ${detail}`;
  return {
    id: `command:remote:${sourceAdapter ?? 'cli'}:${slashName}:${relSource}`,
    kind: 'command',
    name: slashName,
    label: localizedText(`${sourceZh} ${label}`, `${sourceEn} ${label}`),
    detail: sameText(detail),
    insertText: localizedText(zhInsert, enInsert),
    source: relSource,
    sourceAdapter,
  };
}

async function readSkillText(filePath) {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile() || info.size > MAX_SKILL_FILE_BYTES) return null;
  return readFile(filePath, 'utf8').catch(() => null);
}

function relSourceKey(root, target) {
  const rel = relative(root, target).split(sep).join('/');
  return rel || '.';
}

async function scanSkillDir(root, dir, depth, sourceAdapter, out, seen) {
  if (out.length >= MAX_ENTRIES || depth > MAX_SKILL_DEPTH) return;
  const skillFile = join(dir, 'SKILL.md');
  const text = await readSkillText(skillFile);
  if (text != null) {
    const entry = skillEntryFromFile(text, dir, relSourceKey(root, dir), sourceAdapter);
    const key = `${entry.kind}|${entry.name}`.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(entry);
    }
    return;
  }
  let children;
  try {
    children = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  children.sort((a, b) => a.name.localeCompare(b.name));
  for (const child of children) {
    if (out.length >= MAX_ENTRIES) break;
    if (!child.isDirectory()) continue;
    if (SKIP_DIRS.has(child.name)) continue;
    await scanSkillDir(root, join(dir, child.name), depth + 1, sourceAdapter, out, seen);
  }
}

async function scanCommandDir(root, dir, depth, sourceAdapter, out, seen) {
  if (out.length >= MAX_ENTRIES || depth > MAX_COMMAND_DEPTH) return;
  let children;
  try {
    children = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  children.sort((a, b) => a.name.localeCompare(b.name));
  for (const child of children) {
    if (out.length >= MAX_ENTRIES) break;
    const childPath = join(dir, child.name);
    if (child.isDirectory()) {
      if (depth > 0 && SKIP_DIRS.has(child.name)) continue;
      await scanCommandDir(root, childPath, depth + 1, sourceAdapter, out, seen);
      continue;
    }
    if (!child.isFile()) continue;
    const ext = extname(child.name).toLowerCase();
    if (ext !== '.md' && ext !== '.mdx') continue;
    const text = await readSkillText(childPath);
    if (text == null) continue;
    const relFromCommandRoot = relative(root, childPath).split(sep).join('/');
    const entry = commandEntryFromFile(
      text,
      relFromCommandRoot,
      relSourceKey(root, childPath),
      sourceAdapter,
    );
    if (!entry) continue;
    const key = `${entry.kind}|${entry.name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
}

async function dirExistsInside(workspaceRoot, candidate) {
  try {
    const resolved = await realpath(candidate);
    if (!isPathInside(workspaceRoot, resolved)) return null;
    const info = await stat(resolved);
    return info.isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * Scan a remote project's checked-out workspace for slash commands + skills.
 * Looks at the project-level agent dirs only (`<root>/skills`, `<root>/.claude/...`,
 * etc.) — never the server host's global config — so the catalog is scoped to the
 * project the client is viewing. Returns a snapshot the client caches per project.
 */
export async function listWorkspaceSkills({ dir }) {
  const out = [];
  const seen = new Set();
  let root;
  try {
    root = await realpath(dir);
  } catch {
    return { scannedAtMs: Date.now(), ready: true, entries: [] };
  }

  // Project-root skills/ dir (source-agnostic).
  const rootSkills = await dirExistsInside(root, join(root, 'skills'));
  if (rootSkills) await scanSkillDir(rootSkills, rootSkills, 0, null, out, seen);

  for (const [hidden, sourceAdapter] of SKILL_SOURCES) {
    const skillsDir = await dirExistsInside(root, join(root, hidden, 'skills'));
    if (skillsDir) {
      await scanSkillDir(skillsDir, skillsDir, 0, sourceAdapter, out, seen);
    }
    const commandsDir = await dirExistsInside(root, join(root, hidden, 'commands'));
    if (commandsDir) {
      await scanCommandDir(commandsDir, commandsDir, 0, sourceAdapter, out, seen);
    }
  }

  return { scannedAtMs: Date.now(), ready: true, entries: out };
}
