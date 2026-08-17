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
  /** Legacy single-URL field; kept as fallback for old manifests. */
  url: string;
  notes?: string;
  pubDate?: string;
  /** Per-platform asset URLs (v0.5.5+ manifest). */
  platforms?: {
    windows?: string;
    macos?: string;
    linux?: string;
  };
}

/** Coarse runtime platform bucket for asset selection. */
type PlatformBucket = 'windows' | 'macos' | 'linux' | 'other';

/** Detect the host platform from navigator signals. */
function detectPlatform(): PlatformBucket {
  const platform = (
    typeof navigator !== 'undefined'
      ? navigator.platform || ''
      : ''
  ).toLowerCase();
  const ua =
    typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
  if (platform.startsWith('win') || ua.includes('win')) return 'windows';
  if (platform.startsWith('mac') || ua.includes('mac')) return 'macos';
  if (platform.startsWith('linux') || ua.includes('linux')) return 'linux';
  return 'other';
}

/**
 * Pick the best download URL for the current platform.
 *
 * Preference order:
 *  1. `manifest.platforms.<current>` (v0.5.5+ manifest)
 *  2. `manifest.url` (legacy single-URL manifest, or releases/latest page)
 *  3. RELEASES_URL (last-resort web page)
 */
export function pickDownloadUrl(manifest: VersionManifest | null): string {
  if (manifest?.platforms) {
    const bucket = detectPlatform();
    if (bucket !== 'other') {
      const direct = manifest.platforms[bucket];
      if (direct) return direct;
    }
    // Unknown platform: send to releases page so the user can pick.
    return manifest.url || RELEASES_URL;
  }
  return manifest?.url || RELEASES_URL;
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

/** Strip leading v/V and whitespace before comparing version strings. */
function normalizeVersion(v: string): string {
  return v.trim().replace(/^v/i, '');
}

/**
 * Treat the manifest/npm registry as the source of truth: if the latest
 * version string differs from the current one (after normalization), an
 * update is available. This avoids parsing the wide variety of vendor
 * version formats.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  return normalizeVersion(current) !== normalizeVersion(latest);
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
    platforms: data.platforms,
  };
}

/** Check whether a newer version is available. Never throws. */
export async function checkForUpdate(
  signal?: AbortSignal,
): Promise<UpdateStatus> {
  const checkedAt = Date.now();
  try {
    const manifest = await fetchVersionManifest(signal);
    const updateAvailable = isNewerVersion(APP_VERSION, manifest.version);
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
