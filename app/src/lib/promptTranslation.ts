import { extractJsonObject, streamAnthropic } from '@/lib/anthropic';
import { resolveCliInvocation } from '@/lib/cliConfig';
import type { GatewaySelection } from '@/core/ir';
import {
  completeGatewayText,
  resolveCliGatewayRoute,
  resolveDirectGatewayRoute,
} from '@/lib/modelGateway/modelGateway';
import { aiEditViaCli, isTauri } from '@/lib/tauri';
import {
  localeAiName,
  type Locale,
} from '@/lib/i18n';

export interface TranslationSource {
  label?: string;
  text?: string;
}

export type TranslationMap = Partial<Record<Locale, TranslationSource>>;

export interface TranslatePromptOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  adapter?: string;
  selection?: GatewaySelection;
}

interface TranslationResponse {
  translations?: TranslationMap;
}

export async function translatePromptFields(
  source: TranslationSource,
  sourceLocale: Locale,
  targetLocales: Locale[],
  opts: TranslatePromptOptions = {},
): Promise<TranslationMap> {
  const targets = targetLocales.filter((locale) => locale !== sourceLocale);
  if (targets.length === 0) return {};
  if (!source.label && !source.text) {
    return Object.fromEntries(targets.map((locale) => [locale, { label: '', text: '' }])) as TranslationMap;
  }

  const request = {
    sourceLocale,
    sourceLanguage: localeAiName(sourceLocale),
    targetLocales: targets,
    targetLanguages: targets.map((locale) => localeAiName(locale)),
    source,
  };

  const system = [
    'You translate UltraGameStudio prompt-library strings.',
    'Translate faithfully, keeping meaning, tone, placeholders, model ids, code fragments, paths, and product names intact.',
    'Return ONLY a single valid JSON object with this shape:',
    '{ "translations": { "en-US": { "label": "...", "text": "..." } } }',
    'Only include the requested target locale keys. Use simplified Chinese for zh-CN.',
  ].join(' ');

  const userContent = JSON.stringify(request, null, 2);
  const full = await callTranslationModel(system, userContent, opts);
  const parsed = JSON.parse(extractJsonObject(full)) as TranslationResponse;
  const translations = parsed.translations ?? {};
  return Object.fromEntries(
    targets
      .map((locale) => [locale, translations[locale]])
      .filter((entry): entry is [Locale, TranslationSource] => !!entry[1]),
  ) as TranslationMap;
}

async function callTranslationModel(
  system: string,
  userContent: string,
  opts: TranslatePromptOptions,
): Promise<string> {
  if (opts.selection) {
    const direct = resolveDirectGatewayRoute(opts.selection);
    if (direct) {
      return completeGatewayText({
        route: direct,
        system,
        userContent,
        maxTokens: 2048,
      });
    }
    if (isTauri()) {
      const route = await resolveCliGatewayRoute(opts.selection);
      return aiEditViaCli(`${system}\n\n${userContent}`, route.adapter, {
        permission: 'full',
        model: route.model,
        cliCommand: route.cliCommand,
        env: route.env,
      });
    }
  }

  const apiKey = opts.apiKey?.trim();
  const adapter = opts.adapter ?? 'claude-code';
  if (apiKey && adapter === 'claude-code') {
    return streamAnthropic({
      apiKey,
      baseUrl: opts.baseUrl,
      model: opts.model,
      system,
      userContent,
      maxTokens: 2048,
    });
  }

  if (isTauri()) {
    const prompt = `${system}\n\n${userContent}`;
    const cli = await resolveCliInvocation(adapter);
    if (cli.status === 'invalid') {
      throw new Error(cli.error ?? 'CLI 路径不可用，请重新选择。');
    }
    return aiEditViaCli(prompt, adapter, {
      permission: 'full',
      model: opts.model,
      cliCommand: cli.command,
    });
  }

  throw new Error('NO_TRANSLATION_BACKEND');
}
