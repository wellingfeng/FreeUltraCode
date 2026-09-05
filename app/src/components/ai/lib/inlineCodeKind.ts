/**
 * CONTRACT: classify an inline-code token into a display category so the
 * message stream can color 文件名/路径、命令行、参数、函数名、变量名 differently
 * (consumed by {@link InlineCode}). Pure heuristic — anything unrecognized
 * falls back to `code` (the default accent color), so keep the rules
 * conservative: a false negative just loses a color, a false positive paints
 * prose the wrong hue.
 */

import { looksLikePath } from './filePath';

export type InlineCodeKind = 'path' | 'cmd' | 'flag' | 'func' | 'ident' | 'code';

/** First-word commands worth painting as "a command line". Lowercase ids. */
const COMMANDS = new Set([
  // package managers / runtimes
  'npm', 'npx', 'pnpm', 'yarn', 'bun', 'bunx', 'node', 'deno', 'tsx', 'ts-node',
  // vcs
  'git', 'gh', 'svn', 'hg', 'p4',
  // rust
  'cargo', 'rustc', 'rustup',
  // python
  'python', 'python3', 'pip', 'pip3', 'uv', 'uvx', 'poetry', 'pytest', 'ruff', 'black',
  // jvm / dotnet
  'java', 'javac', 'gradle', 'mvn', 'dotnet', 'msbuild',
  // build / lint / test
  'make', 'cmake', 'ninja', 'tsc', 'eslint', 'prettier', 'biome', 'vitest',
  'jest', 'playwright', 'vite', 'webpack', 'rollup', 'esbuild',
  // shell builtins / coreutils
  'cd', 'ls', 'dir', 'pwd', 'cp', 'mv', 'rm', 'rmdir', 'mkdir', 'touch', 'cat',
  'head', 'tail', 'echo', 'grep', 'rg', 'fd', 'find', 'sed', 'awk', 'chmod',
  'chown', 'sudo', 'which', 'where', 'export', 'set', 'source', 'ln', 'tar',
  'zip', 'unzip', '7z', 'curl', 'wget', 'ssh', 'scp',
  // platforms / tools
  'docker', 'kubectl', 'helm', 'code', 'rider', 'winget', 'brew', 'apt', 'scoop',
  'powershell', 'pwsh', 'cmd', 'start', 'robocopy', 'xcopy',
]);

/**
 * Non-ASCII (CJK prose in backticks) never gets a token color — it would read
 * as noise, and the path/command regexes are ASCII-only anyway.
 */
function containsNonAscii(text: string): boolean {
  return Array.from(text).some((ch) => ch.charCodeAt(0) > 0x7f);
}

/**
 * Classify the text of one inline-code span.
 *
 * Order matters: flag → cmd → func → path → ident. Flags must win over cmd
 * (`--noEmit` is not a command); cmd must win over func (`npm test` is not a
 * function call); path must win over ident (`package.json` is a filename, not
 * a variable).
 */
export function classifyInlineCode(raw: string): InlineCodeKind {
  const text = raw.trim();
  if (!text || containsNonAscii(text)) return 'code';

  // `--noEmit` / `-p` / `--force` — leading dashes, then a letter.
  if (/^-{1,2}[A-Za-z][\w-]*$/.test(text)) return 'flag';

  // Command line: `npm test -- MessageContent`, `git status`, `cargo build`.
  const firstWord = /^([\w.+-]+)(?:\s|$)/.exec(text);
  if (firstWord && COMMANDS.has(firstWord[1].toLowerCase())) return 'cmd';

  // Function call: `foo()`, `foo(bar)`, `obj.method(arg)`, trailing `)` optional
  // so a streamed half-token `foo(` still colors correctly.
  if (/^[A-Za-z_$][\w$]*(?:\.[\w$]+)*\s*\(.*?\)?$/.test(text)) return 'func';

  // File / path: `src/lib/foo.ts`, `package.json`, `Cargo.lock`, `E:\x\y.png`.
  // (allowSpaces: paths with spaces stay legible even without a separator hit.)
  if (looksLikePath(text, { allowSpaces: true })) return 'path';

  // Single identifier-ish token: `useState`, `MessageContent`, `rehyype-raw`,
  // `react-markdown`, `@vitejs/plugin`. Must contain a letter so `-`/`0.5` miss.
  if (/^[A-Za-z_$@][\w$@+.-]*$/.test(text) && /[A-Za-z]/.test(text)) return 'ident';

  return 'code';
}
