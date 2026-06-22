import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const root = dirname(appDir);

const workflowsRoot = join(appDir, 'src-tauri', 'resources', 'workflows');

const failures = [];
const workflowDirs = existsSync(workflowsRoot)
  ? readdirSync(workflowsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(workflowsRoot, entry.name))
  : [];

for (const workflowRoot of workflowDirs) {
  const workflowFile = join(workflowRoot, 'WORKFLOW.md');
  if (!existsSync(workflowFile)) {
    failures.push(`missing ${relative(root, workflowFile)}`);
    continue;
  }
  if (!statSync(workflowFile).isFile()) {
    failures.push(`not a file ${relative(root, workflowFile)}`);
    continue;
  }

  const text = readFileSync(workflowFile, 'utf8');
  if (text.trim().length < 200) {
    failures.push(`too short ${relative(root, workflowFile)}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `Built-in workflow resource check failed:\n${failures.join('\n')}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  workflowDirs.length === 0
    ? 'No built-in workflow resources are configured.\n'
    : 'Built-in workflow resources are complete.\n',
);
