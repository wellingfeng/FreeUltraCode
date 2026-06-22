/**
 * CONTRACT: version + update checking against the GitHub-hosted manifest.
 *
 * The app ships a compile-time {@link APP_VERSION} (injected from package.json
 * via the Vite `define` for `__APP_VERSION__`; see vite.config.ts). At runtime
 * we fetch `app/version.txt` from the repo's raw GitHub endpoint, parse the JSON
 * manifest, and compare semver-ish versions to decide whether a newer release
 * is available.
 *
 * Browser-safe: {@link openDownload}/{@link openExternal} degrade to
 * `window.open` outside the Tauri desktop shell.
 */
import { openExternal } from '@/lib/tauri';

/** Canonical GitHub project URL. */
export const REPO_URL = 'https://github.com/wellingfeng/UltraGameStudio';
/** Releases / changelog page. */
export const RELEASES_URL = `${REPO_URL}/releases`;
/** Raw manifest consumed by {@link fetchVersionManifest}. */
export const VERSION_MANIFEST_URL =
  'https://raw.githubusercontent.com/wellingfeng/UltraGameStudio/main/app/version.txt';

/** Compile-time version, injected by Vite (falls back to 0.0.0 in tests). */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

/** Shape of the JSON in app/version.txt. */
export interface VersionManifest {
  version: string;
  url: string;
  notes?: string;
  pubDate?: string;
}

/** Result of an update check; `error` is set when the network/parse failed. */
export interface UpdateStatus {
  current: string;
  latest: string | null;
  manifest: VersionManifest | null;
  updateAvailable: boolean;
  checkedAt: number;
  error?: string;
}

/** Parse a version string ("v1.2.3" -> [1,2,3]); non-numeric parts -> 0. */
function parseVersion(v: string): number[] {
  return v
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((p) => {
      const n = parseInt(p, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

/** Semver-ish compare: -1 if a<b, 0 if equal, 1 if a>b. */
export function compareSemver(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

/** Fetch + parse the remote manifest. Throws on network/parse failure. */
export async function fetchVersionManifest(
  signal?: AbortSignal,
): Promise<VersionManifest> {
  const res = await fetch(`${VERSION_MANIFEST_URL}?t=${Date.now()}`, {
    signal,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const data = JSON.parse(text) as Partial<VersionManifest>;
  if (
    !data ||
    typeof data.version !== 'string' ||
    typeof data.url !== 'string'
  ) {
    throw new Error('malformed manifest');
  }
  return {
    version: data.version,
    url: data.url,
    notes: data.notes,
    pubDate: data.pubDate,
  };
}

/** Check whether a newer version is available. Never throws. */
export async function checkForUpdate(
  signal?: AbortSignal,
): Promise<UpdateStatus> {
  const checkedAt = Date.now();
  try {
    const manifest = await fetchVersionManifest(signal);
    const updateAvailable = compareSemver(manifest.version, APP_VERSION) > 0;
    return {
      current: APP_VERSION,
      latest: manifest.version,
      manifest,
      updateAvailable,
      checkedAt,
    };
  } catch (err) {
    return {
      current: APP_VERSION,
      latest: null,
      manifest: null,
      updateAvailable: false,
      checkedAt,
      error: (err as Error).message,
    };
  }
}

/** Open the download URL in the user's browser (Tauri) or a new tab (web). */
export async function openDownload(url: string): Promise<void> {
  await openExternal(url);
}
