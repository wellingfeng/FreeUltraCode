/**
 * CONTRACT: parseToolLine(line) -> { name, detail } | null
 *
 * Detects a run-progress "tool call" line emitted by the CLI runtime and splits
 * it into a tool name + detail so the renderer can style it distinctly (smaller,
 * monospace, muted) instead of as ordinary prose.
 *
 * Two shapes are produced by the runtime (see cli/io/stream.ts):
 *   - Claude:  `🔧 Bash: ls app/src`            → emoji prefix
 *   - Codex:   `🔧 command_execution: rg -n …`   → emoji + snake_case item type
 * The emoji may be stripped by some transports, so we also match a bare leading
 * `name:` when `name` looks like a tool token (snake_case or CamelCase word).
 */

export interface ToolLine {
  /** The tool / item-type label, e.g. "Bash" or "command_execution". */
  name: string;
  /** The remaining detail (command, path, query…), possibly empty. */
  detail: string;
}

// 🔧 Name: detail   (emoji optional)
// Keep the name ASCII/token-shaped. Models also use 🔧 as a prose bullet; those
// lines must stay ordinary markdown instead of shrinking into ToolLine chrome.
const WITH_EMOJI = /^\s*🔧\s*([A-Za-z][A-Za-z0-9_.-]{0,80})\s*(?::\s*(.*))?$/u;
// Bare "name: detail" where name is a plausible tool token and detail is non-empty.
const BARE = /^\s*([a-z][a-z0-9_]*[a-z0-9]|[A-Z][A-Za-z0-9]+)\s*:\s*(.+)$/;

/** A small allow-list of bare item-type names the runtime emits without the emoji. */
const KNOWN_TOOLS = new Set([
  'command_execution',
  'file_change',
  'file_read',
  'file_write',
  'web_search',
  'mcp_tool_call',
  'patch',
  'reasoning',
  'agent_message',
  'bash',
  'read',
  'edit',
  'write',
  'grep',
  'glob',
  'task',
]);

export function parseToolLine(line: string): ToolLine | null {
  const emoji = line.match(WITH_EMOJI);
  if (emoji) {
    return { name: emoji[1].trim(), detail: (emoji[2] ?? '').trim() };
  }
  const bare = line.match(BARE);
  if (bare && KNOWN_TOOLS.has(bare[1].toLowerCase())) {
    return { name: bare[1], detail: bare[2].trim() };
  }
  return null;
}
