import { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Search,
} from 'lucide-react';
import {
  GAME_PROJECT_COMMAND_NAMES,
  PROJECT_COMMAND_NAMES,
  buildGameSkillSuggestions,
  type SlashSuggestion,
} from '@/lib/slashCommands';
import {
  t,
  type Locale,
} from '@/lib/i18n';

const SETTINGS_COMMAND_NAMES = [
  ...PROJECT_COMMAND_NAMES,
  ...GAME_PROJECT_COMMAND_NAMES.filter(
    (name) =>
      !PROJECT_COMMAND_NAMES.some(
        (existing) => existing.toLowerCase() === name.toLowerCase(),
      ),
  ),
];

const SETTINGS_COMMAND_NAME_SET: ReadonlySet<string> = new Set(
  SETTINGS_COMMAND_NAMES.map((name) => name.toLowerCase()),
);

export default function CommandsSettings({ locale }: { locale: Locale }) {
  const [query, setQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Curated built-in commands from the former global and project command tabs.
  // Generic prompt shortcuts and backend-discovered CLI/skill commands still
  // live in the inline `/` menu.
  const commands = useMemo(() => {
    const order = new Map(
      SETTINGS_COMMAND_NAMES.map((name, index) => [name.toLowerCase(), index]),
    );
    return buildGameSkillSuggestions(locale)
      .filter((item) =>
        SETTINGS_COMMAND_NAME_SET.has(item.name.trim().toLowerCase()),
      )
      .sort(
        (a, b) =>
          (order.get(a.name.toLowerCase()) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.name.toLowerCase()) ?? Number.MAX_SAFE_INTEGER),
      );
  }, [locale]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((item) => item.searchText.includes(q));
  }, [commands, query]);

  const copyName = (item: SlashSuggestion) => {
    void navigator.clipboard?.writeText(item.name).then(
      () => {
        setCopiedId(item.id);
        window.setTimeout(() => {
          setCopiedId((current) => (current === item.id ? null : current));
        }, 1500);
      },
      () => {},
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-fg">
          {t(locale, 'settings.commandsTitle')}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-fg-faint">
          {t(locale, 'settings.commandsDescription')}
        </p>
      </div>

      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint"
        />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t(locale, 'settings.commandsSearchPlaceholder')}
          className="w-full rounded-lg border border-border bg-bg-alt py-2 pl-9 pr-3 text-sm text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-border bg-bg-alt px-4 py-6 text-center text-xs text-fg-faint">
          {t(locale, 'settings.commandsEmpty')}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <CommandRow
              key={item.id}
              item={item}
              locale={locale}
              copied={copiedId === item.id}
              onCopy={() => copyName(item)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CommandRow({
  item,
  locale,
  copied,
  onCopy,
}: {
  item: SlashSuggestion;
  locale: Locale;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="group grid gap-2 rounded-lg border border-border bg-bg-alt px-4 py-3 md:grid-cols-[minmax(10rem,16rem)_minmax(0,1fr)] md:items-start">
      <div className="flex min-w-0 items-center gap-2">
        <code className="truncate font-mono text-sm font-medium text-accent">
          {item.name}
        </code>
        <button
          type="button"
          onClick={onCopy}
          aria-label={t(locale, 'settings.commands.copy')}
          title={t(locale, 'settings.commands.copy')}
          className="ml-auto shrink-0 rounded p-1 text-fg-faint opacity-0 transition-opacity hover:text-fg focus:opacity-100 group-hover:opacity-100"
        >
          {copied ? (
            <Check size={13} className="text-accent-2" />
          ) : (
            <Copy size={13} />
          )}
        </button>
      </div>
      <div className="min-w-0">
        {item.label && item.label !== item.name && (
          <div className="text-sm font-medium text-fg">{item.label}</div>
        )}
        {item.detail && (
          <p className="mt-0.5 text-xs leading-relaxed text-fg-faint">
            {item.detail}
          </p>
        )}
      </div>
    </div>
  );
}
