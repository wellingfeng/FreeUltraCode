#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bundleByPlatform = {
  win32: 'nsis',
  darwin: 'app,dmg',
  linux: 'deb,appimage',
};

const bundles = bundleByPlatform[process.platform];
if (!bundles) {
  console.error(`Unsupported platform for Tauri packaging: ${process.platform}`);
  process.exit(1);
}

const env = { ...process.env };
if (process.platform === 'win32' && !env.RUSTUP_TOOLCHAIN) {
  env.RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-msvc';
}

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseDir = join(appDir, 'src-tauri', 'target', 'release');
const nsisDir = join(releaseDir, 'bundle', 'nsis');
const staleProductPrefix = 'Free' + 'Ultra' + 'Code';

for (const dir of [releaseDir, nsisDir]) {
  if (!existsSync(dir)) continue;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(staleProductPrefix)) continue;
    rmSync(join(dir, entry.name), { force: true });
  }
}

const result = spawnSync('tauri', ['build', '--bundles', bundles], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env,
});

process.exit(result.status ?? 1);
