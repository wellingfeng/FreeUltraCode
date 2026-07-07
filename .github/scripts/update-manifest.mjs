// Post-publish manifest sync: pull real asset URLs from the GitHub Release
// and rewrite app/version.txt so the manifest always matches what was
// actually uploaded (handles Tauri's auto-versioned filenames, universal
// vs aarch64/x86_64 suffixes, etc.).
//
// Usage: node update-manifest.mjs <tag> [repo]
//   tag  - release tag, e.g. v0.5.5
//   repo - owner/repo, defaults to wellingfeng/UltraGameStudio
//
// Requires `gh` CLI authenticated with repo:read scope; we invoke
// `gh release view --json assets,url,publishedAt` and match assets by
// extension to platform buckets.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifestPath = join(root, 'app', 'version.txt');

const tag = process.argv[2];
const repo = process.argv[3] || 'wellingfeng/UltraGameStudio';
if (!tag) {
  console.error('update-manifest: missing tag argument');
  process.exit(1);
}

// Pull release assets via gh CLI.
const raw = execSync(
  `gh release view ${tag} --repo ${repo} --json assets,url,publishedAt,tagName`,
  { encoding: 'utf8' },
);
const rel = JSON.parse(raw);
const assets = Array.isArray(rel.assets) ? rel.assets : [];
if (assets.length === 0) {
  console.error(`update-manifest: release ${tag} has no assets; skipping`);
  process.exit(2);
}

// Match by filename pattern. Priority order per platform.
function pickAsset(patterns) {
  for (const p of patterns) {
    const hit = assets.find((a) => p.test(a.name));
    if (hit) return hit;
  }
  return null;
}

const win = pickAsset([/-setup\.exe$/i, /\.exe$/i]);
const mac = pickAsset([/_universal\.dmg$/i, /\.dmg$/i, /\.app$/i]);
const linux = pickAsset([/\.AppImage$/i, /_amd64\.deb$/i, /\.deb$/i]);

const version = tag.replace(/^v/i, '');
const manifest = {
  version,
  notes: `UltraGameStudio ${tag}`,
  pubDate:
    (rel.publishedAt && rel.publishedAt.slice(0, 10)) ||
    new Date().toISOString().slice(0, 10),
  platforms: {
    ...(win ? { windows: win.url } : {}),
    ...(mac ? { macos: mac.url } : {}),
    ...(linux ? { linux: linux.url } : {}),
  },
  url: rel.url || `https://github.com/${repo}/releases/latest`,
};

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`update-manifest: version.txt synced for ${tag}`);
console.log(
  JSON.stringify(
    {
      windows: win?.name || null,
      macos: mac?.name || null,
      linux: linux?.name || null,
    },
    null,
    2,
  ),
);
