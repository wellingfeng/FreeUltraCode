import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listWorkspaceDirectory,
  workspaceTreeRelativeKey,
} from '../src/workspace-files.mjs';

test('workspaceTreeRelativeKey normalizes slashes and trims roots', () => {
  assert.equal(workspaceTreeRelativeKey('\\src\\ui\\'), 'src/ui');
  assert.equal(workspaceTreeRelativeKey('/'), '');
});

test('listWorkspaceDirectory returns sorted project entries without leaking server root', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ugs-workspace-files-'));
  try {
    await mkdir(join(dir, 'src'));
    await mkdir(join(dir, 'node_modules'));
    await writeFile(join(dir, 'README.md'), '# hi\n');
    await writeFile(join(dir, '.env'), 'TOKEN=x\n');
    await writeFile(join(dir, 'src', 'main.ts'), 'console.log(1);\n');

    const root = await listWorkspaceDirectory({
      dir,
      rootPath: 'remote-project://proj_test',
    });

    assert.deepEqual(
      root.entries.map((entry) => [entry.kind, entry.relativePath]),
      [
        ['file', '.env'],
        ['file', 'README.md'],
        ['directory', 'src'],
      ].sort((a, b) => {
        if (a[0] !== b[0]) return a[0] === 'directory' ? -1 : 1;
        return String(a[1]).toLowerCase().localeCompare(String(b[1]).toLowerCase());
      }),
    );
    assert.equal(root.entries.some((entry) => entry.relativePath === 'node_modules'), false);
    assert.equal(root.entries.find((entry) => entry.relativePath === 'src')?.path, 'remote-project://proj_test/src');
    assert.equal(JSON.stringify(root).includes(dir), false);

    const nested = await listWorkspaceDirectory({
      dir,
      rootPath: 'remote-project://proj_test',
      relativePath: 'src',
    });
    assert.equal(nested.relativePath, 'src');
    assert.equal(nested.entries[0]?.path, 'remote-project://proj_test/src/main.ts');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
