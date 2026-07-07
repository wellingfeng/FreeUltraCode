// Cross-platform version bumper for UltraGameStudio release flow.
// Usage: node bump-version.mjs <version>
// Updates: app/package.json, app/src-tauri/tauri.conf.json,
//          app/src-tauri/Cargo.toml, app/version.txt
// Idempotent: safe to run multiple times with the same version.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rawVersion = process.argv[2];
if (!rawVersion) {
  console.error('bump-version: missing version argument');
  process.exit(1);
}
const version = rawVersion.replace(/^v/i, '').trim();
if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`bump-version: invalid version "${version}"`);
  process.exit(1);
}

const pkgPath = join(root, 'app', 'package.json');
const tauriPath = join(root, 'app', 'src-tauri', 'tauri.conf.json');
const cargoPath = join(root, 'app', 'src-tauri', 'Cargo.toml');
const manifestPath = join(root, 'app', 'version.txt');

// 1. package.json
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`bump-version: package.json -> ${version}`);

// 2. tauri.conf.json
const tauri = JSON.parse(readFileSync(tauriPath, 'utf8'));
tauri.version = version;
writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + '\n');
console.log(`bump-version: tauri.conf.json -> ${version}`);

// 3. Cargo.toml (only the [package] version line)
const cargoSrc = readFileSync(cargoPath, 'utf8');
const cargoRe = /^(\[package\][\s\S]*?^version\s*=\s*)"[^"]*"/m;
if (!cargoRe.test(cargoSrc)) {
  console.error('bump-version: Cargo.toml version line not matched');
  process.exit(1);
}
const cargoOut = cargoSrc.replace(cargoRe, `$1"${version}"`);
writeFileSync(cargoPath, cargoOut);
console.log(`bump-version: Cargo.toml -> ${version}`);

// 4. version.txt manifest (consumed by app/src/lib/updateCheck.ts)
//    Multi-platform: each platform gets its own asset URL. Top-level `url`
//    is kept as a fallback (points to the releases/latest page so legacy
//    clients land on a platform-agnostic download page).
const tagName = `v${version}`;
const repo = 'wellingfeng/UltraGameStudio';
const releaseBase = `https://github.com/${repo}/releases/download/${tagName}`;
const manifest = {
  version,
  notes: `UltraGameStudio ${tagName}`,
  pubDate: new Date().toISOString().slice(0, 10),
  platforms: {
    windows: `${releaseBase}/UltraGameStudio_${version}_x64-setup.exe`,
    macos: `${releaseBase}/UltraGameStudio_${version}_universal.dmg`,
    linux: `${releaseBase}/UltraGameStudio_${version}_amd64.AppImage`,
  },
  url: `https://github.com/${repo}/releases/latest`,
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`bump-version: version.txt -> ${version} (multi-platform)`);
