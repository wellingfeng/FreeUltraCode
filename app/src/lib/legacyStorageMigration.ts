/**
 * One-time localStorage migration for both historical rebrands:
 * OpenWorkflow -> FreeUltraCode -> UltraGameStudio.
 *
 * Keep the old key literals here only so existing browser/dev data survives.
 * Product-facing code uses the new `ugs` / `ultragamestudio` namespaces.
 */
const SENTINEL = 'ugs_legacy_brand_migrated_v3';

function migrateLegacyStorage(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem(SENTINEL)) return;

    // Snapshot keys first — we mutate localStorage while iterating.
    const legacyKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.startsWith('owf_') ||
          key.startsWith('owf-') ||
          key.startsWith('fuc_') ||
          key.startsWith('fuc-') ||
          key.startsWith('openworkflow.') ||
          key.startsWith('freeultracode.'))
      ) {
        legacyKeys.push(key);
      }
    }

    for (const oldKey of legacyKeys) {
      let newKey: string;
      if (oldKey.startsWith('owf_')) newKey = `ugs_${oldKey.slice(4)}`;
      else if (oldKey.startsWith('owf-')) newKey = `ugs-${oldKey.slice(4)}`;
      else if (oldKey.startsWith('fuc_')) newKey = `ugs_${oldKey.slice(4)}`;
      else if (oldKey.startsWith('fuc-')) newKey = `ugs-${oldKey.slice(4)}`;
      else if (oldKey.startsWith('openworkflow.')) {
        newKey = `ultragamestudio.${oldKey.slice('openworkflow.'.length)}`;
      } else {
        newKey = `ultragamestudio.${oldKey.slice('freeultracode.'.length)}`;
      }
      // Don't overwrite a value the rebranded build already persisted.
      if (localStorage.getItem(newKey) !== null) continue;
      const value = localStorage.getItem(oldKey);
      if (value !== null) localStorage.setItem(newKey, value);
    }

    localStorage.setItem(SENTINEL, '1');
  } catch {
    /* storage disabled / quota — nothing we can do, fail silently */
  }
}

migrateLegacyStorage();
