// Shared slash command / skill catalog model.
//
// CONTRACT: This module owns the *data* layer for slash commands and skills so
// that the inline `/` suggestion menu (AIDock) and the read-only Commands list
// (SettingsModal) never drift. Interaction concerns (trigger detection, adapter
// scoping, top-N filtering) deliberately stay in AIDock; everything here is a
// pure transform over the backend slash catalog plus the app-only static
// entries the catalog does not enumerate.
import type { Locale } from "@/lib/i18n";
import type { SlashCatalogEntry } from "@/lib/tauri";
import type { RuntimeAdapterId } from "@/lib/adapters";
import type { GameSkillCommand } from "@/lib/gameSkill";
import {
  APP_CAPABILITY_MANIFESTS,
  GAME_SKILL_CAPABILITY_MANIFESTS,
  GAME_PROJECT_COMMAND_NAMES as CAPABILITY_GAME_PROJECT_COMMAND_NAMES,
  PROJECT_COMMAND_NAMES as CAPABILITY_PROJECT_COMMAND_NAMES,
} from "@/lib/capabilityCatalog";
import { capabilityCommand } from "@/lib/capabilityManifest";
import { isAppSlashCommandEnabled } from "@/lib/featureFlags";

export type SlashSuggestionKind = "command" | "skill";
export type SlashSourceAdapter = RuntimeAdapterId | "app" | "agent";

export interface StaticSlashEntry {
  id: string;
  kind: SlashSuggestionKind;
  name: string;
  label: Partial<Record<Locale, string>>;
  detail: Partial<Record<Locale, string>>;
  insertText: Partial<Record<Locale, string>>;
  source?: string | null;
  sourceAdapter?: SlashSourceAdapter | null;
}

export interface SlashSuggestion {
  id: string;
  kind: SlashSuggestionKind;
  name: string;
  label: string;
  detail: string;
  insertText: string;
  source?: string | null;
  sourceAdapter?: SlashSourceAdapter | null;
  searchText: string;
}

// GAME_SKILL_COMMANDS = the versioned CapabilityManifest catalog projected to
// the runtime data shape. GameSkill remains the authoring helper, but downstream
// command/menu surfaces consume manifests so metadata (version, resources,
// settings, rollback, surfaces) has one source.
//
// CONTRACT: GameSkills are surfaced through both the generic `/` menu and the
// faster `#游戏Skill` trigger. `/` is the global command surface; `#` is the
// narrow app-curated GameSkill surface for faster discovery.
export const GAME_SKILL_COMMANDS: GameSkillCommand[] =
  GAME_SKILL_CAPABILITY_MANIFESTS.map(capabilityCommand);

// SLASH_COMMANDS keeps the full data set (GameSkills + generic shortcuts) so
// submit-time slash expansion keeps resolving regardless of which menu surfaces
// the command.
export const SLASH_COMMANDS: GameSkillCommand[] = [
  ...APP_CAPABILITY_MANIFESTS.map(capabilityCommand),
];

function toStaticSlashEntry(command: GameSkillCommand): StaticSlashEntry {
  return {
    id: `command:${command.name}`,
    kind: "command",
    name: command.name,
    label: command.label,
    detail: command.detail,
    insertText: command.text,
    source: "app",
    sourceAdapter: "app",
  };
}

// STATIC_SLASH_ENTRIES backs the `/` menu fallback / fold-in. It includes the
// app-defined GameSkills plus generic prompt shortcuts so `/` remains the full
// global command surface even when the backend catalog is missing app entries.
export const STATIC_SLASH_ENTRIES: StaticSlashEntry[] = [
  ...SLASH_COMMANDS.map(toStaticSlashEntry),
];

// GAME_SKILL_STATIC_ENTRIES backs the `#游戏Skill` menu and the read-only
// Commands lists in Settings / Project Settings.
export const GAME_SKILL_STATIC_ENTRIES: StaticSlashEntry[] =
  GAME_SKILL_COMMANDS.map(toStaticSlashEntry);

// UltraGameStudio-specific commands surfaced in the global Settings > Commands tab.
//
// CONTRACT: This is a curated allowlist, NOT everything in SLASH_COMMANDS. The
// inline `/` menu intentionally also offers generic prompt shortcuts (/plan,
// /review, /diagnose, ...) and whatever the backend slash catalog discovers
// (CLI commands, user skills), but the Commands tab is a reference for the
// app-native flows that ship with UltraGameStudio. Game-specific commands are
// folded into the same global Settings > Commands surface by the UI so there is
// only one commands reference tab. /image-to-game is intentionally also listed
// here because it is a reusable reference-image analysis workflow, not tied to
// a detected game workspace.
export const PROJECT_COMMAND_NAMES = CAPABILITY_PROJECT_COMMAND_NAMES;

// Game-only slash commands folded into global Settings > Commands. Grouped by
// game workflow family (Game Experts, Mesh, online model library, Sprite, UI).
// Sprite lives here (not in PROJECT_COMMAND_NAMES) because these commands are
// gated behind game projects at execution time, while the channel configuration
// itself lives in global Settings.
export const GAME_PROJECT_COMMAND_NAMES = CAPABILITY_GAME_PROJECT_COMMAND_NAMES;

const PROJECT_COMMAND_NAME_SET: ReadonlySet<string> = new Set(
  PROJECT_COMMAND_NAMES.map((name) => name.toLowerCase()),
);

const GAME_PROJECT_COMMAND_NAME_SET: ReadonlySet<string> = new Set(
  GAME_PROJECT_COMMAND_NAMES.map((name) => name.toLowerCase()),
);

export function isProjectCommandName(name: string): boolean {
  return PROJECT_COMMAND_NAME_SET.has(name.trim().toLowerCase());
}

export function isGameProjectCommandName(name: string): boolean {
  return GAME_PROJECT_COMMAND_NAME_SET.has(name.trim().toLowerCase());
}

export function slashText(
  value: Partial<Record<Locale, string>> | Record<string, string | undefined>,
  locale: Locale,
): string {
  return value[locale] ?? value["en-US"] ?? value["zh-CN"] ?? "";
}

function normalizeSlashSourceAdapter(
  value: unknown,
): SlashSourceAdapter | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "claude" || normalized === "anthropic") {
    return "claude-code";
  }
  if (
    normalized === "claude-code" ||
    normalized === "codex" ||
    normalized === "gemini" ||
    normalized === "app" ||
    normalized === "agent"
  ) {
    return normalized;
  }
  return null;
}

function slashSourceAdapterFromPath(value: unknown): SlashSourceAdapter | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const source = value.replace(/\\/g, "/").toLowerCase();
  if (source.includes("/.claude/")) return "claude-code";
  if (source.includes("/.codex/")) return "codex";
  if (source.includes("/.gemini/")) return "gemini";
  if (source.includes("/.agents/")) return "agent";
  return null;
}

export function slashEntrySourceAdapter(
  entry: StaticSlashEntry | SlashCatalogEntry,
): SlashSourceAdapter | null {
  const direct = normalizeSlashSourceAdapter(
    (entry as { sourceAdapter?: string | null }).sourceAdapter,
  );
  if (direct) return direct;

  const source = entry.source ?? "";
  const fromSource =
    normalizeSlashSourceAdapter(source) ?? slashSourceAdapterFromPath(source);
  if (fromSource) return fromSource;

  const idSource = /^(?:command|skill):([^:]+):/.exec(entry.id)?.[1];
  return (
    normalizeSlashSourceAdapter(idSource) ??
    slashSourceAdapterFromPath(entry.id)
  );
}

function slashCommandEnabled(name: string): boolean {
  return isAppSlashCommandEnabled(name);
}

function isAppSlashEntry(entry: StaticSlashEntry | SlashCatalogEntry): boolean {
  const source = entry.source?.trim().toLowerCase() ?? "";
  if (source === "app") return true;
  if (entry.id.toLowerCase().startsWith("command:app:")) return true;
  return slashEntrySourceAdapter(entry) === "app";
}

// App-implemented commands live in STATIC_SLASH_ENTRIES. The Tauri backend slash
// catalog is authoritative for external CLI/skill commands and intentionally
// does not enumerate app features, so when it returns a catalog we must still
// fold in app-only static entries — otherwise these commands silently vanish
// from the `/` suggestion menu in the desktop build.
export function withAppOnlyStaticEntries(
  catalogEntries: SlashCatalogEntry[],
): (SlashCatalogEntry | StaticSlashEntry)[] {
  const enabledCatalogEntries = catalogEntries.filter((entry) =>
    slashCommandEnabled(entry.name),
  );
  const present = new Set(
    enabledCatalogEntries
      .filter(isAppSlashEntry)
      .map((entry) => entry.name.trim().toLowerCase()),
  );
  const missing = STATIC_SLASH_ENTRIES.filter(
    (entry) => !present.has(entry.name.trim().toLowerCase()),
  );
  return [...enabledCatalogEntries, ...missing];
}

function mapEntryToSuggestion(
  entry: SlashCatalogEntry | StaticSlashEntry,
  locale: Locale,
): SlashSuggestion {
  const label = slashText(entry.label, locale);
  const detail = slashText(entry.detail, locale);
  const insertText = slashText(entry.insertText, locale);
  const source = entry.source ?? "";
  const sourceAdapter = slashEntrySourceAdapter(entry);
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    label,
    detail,
    insertText,
    source,
    sourceAdapter,
    searchText: `${entry.name} ${label} ${detail} ${insertText} ${source} ${
      sourceAdapter ?? ""
    }`.toLowerCase(),
  };
}

function dedupeSuggestions(
  entries: (SlashCatalogEntry | StaticSlashEntry)[],
  locale: Locale,
): SlashSuggestion[] {
  const seen = new Set<string>();
  const out: SlashSuggestion[] = [];
  for (const entry of entries) {
    const source = entry.source ?? "";
    const key =
      `${entry.kind}:${source || entry.id}:${entry.name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mapEntryToSuggestion(entry, locale));
  }
  return out;
}

export function buildSlashSuggestions(
  catalogEntries: SlashCatalogEntry[],
  locale: Locale,
): SlashSuggestion[] {
  const entries: (SlashCatalogEntry | StaticSlashEntry)[] =
    catalogEntries.length > 0
      ? withAppOnlyStaticEntries(catalogEntries)
      : STATIC_SLASH_ENTRIES.filter((entry) => slashCommandEnabled(entry.name));
  return dedupeSuggestions(entries, locale);
}

// GameSkill suggestions powering the `#游戏Skill` menu (AIDock) and the
// read-only Commands lists in Settings / Project Settings. Always sourced from
// the GameSkill registry; independent of the backend slash catalog.
export function buildGameSkillSuggestions(locale: Locale): SlashSuggestion[] {
  return dedupeSuggestions(GAME_SKILL_STATIC_ENTRIES, locale);
}
