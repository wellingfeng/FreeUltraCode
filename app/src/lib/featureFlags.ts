export const STUDIO_ENABLED = false;

const DISABLED_APP_SLASH_COMMAND_NAMES = new Set<string>([
  "/deep-research",
  "/studio",
]);

export function isStudioEnabled(): boolean {
  return STUDIO_ENABLED;
}

export function isAppSlashCommandEnabled(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (normalized === "/studio") return STUDIO_ENABLED;
  return !DISABLED_APP_SLASH_COMMAND_NAMES.has(normalized);
}
