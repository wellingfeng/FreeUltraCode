import { summarizeJobs } from './usage.mjs';

const DEFAULT_ACCOUNT_LIMIT = 0;

function normalizeId(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function numberFrom(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_ACCOUNT_LIMIT;
}

function modelsFrom(value, fallback) {
  const raw = Array.isArray(value) ? value : fallback ? [fallback] : [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const model = String(item ?? '').trim();
    if (!model) continue;
    const key = model.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(model);
  }
  return out;
}

function parseAccountsJson(raw) {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn(`[runner] failed to parse UGS_RUNNER_ACCOUNTS: ${err.message}`);
    return [];
  }
}

export function normalizeAccount(input, index = 0) {
  if (!input || typeof input !== 'object') return null;
  const adapter = String(input.adapter ?? '').trim().toLowerCase();
  if (!adapter) return null;
  const id = normalizeId(input.id) || `${adapter}-${index + 1}`;
  const model = String(input.model ?? '').trim() || null;
  const projectId = normalizeId(input.projectId) || null;
  return {
    id,
    projectId,
    label: String(input.label ?? input.name ?? id).trim() || id,
    adapter,
    model,
    models: modelsFrom(input.models, model),
    apiKey: String(input.apiKey ?? '').trim() || null,
    apiKeyEnv: String(input.apiKeyEnv ?? '').trim() || null,
    baseUrl: String(input.baseUrl ?? '').trim() || null,
    baseUrlEnv: String(input.baseUrlEnv ?? '').trim() || null,
    dailyTokenLimit: numberFrom(input.dailyTokenLimit),
    monthlyTokenLimit: numberFrom(input.monthlyTokenLimit),
    enabled: input.enabled !== false,
  };
}

function envAccount(env, adapter, keyEnv, baseUrlEnv, label) {
  const hasKey = Boolean(env[keyEnv]);
  const hasBaseUrl = Boolean(env[baseUrlEnv]);
  if (!hasKey && !hasBaseUrl) return null;
  return normalizeAccount(
    {
      id: `${adapter}-server`,
      label,
      adapter,
      apiKeyEnv: keyEnv,
      baseUrlEnv,
      enabled: true,
    },
    0,
  );
}

export function loadAccountsFromEnv(env = process.env) {
  const raw = env.UGS_RUNNER_ACCOUNTS || env.FUC_RUNNER_ACCOUNTS || '';
  const configured = parseAccountsJson(raw)
    .map((item, index) => normalizeAccount(item, index))
    .filter(Boolean);

  const fallback = [
    envAccount(env, 'claude', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'Claude server key'),
    envAccount(env, 'codex', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'Codex server key'),
    envAccount(env, 'gemini', 'GEMINI_API_KEY', 'GOOGLE_GEMINI_BASE_URL', 'Gemini server key'),
  ].filter(Boolean);

  const ids = new Set();
  return [...configured, ...fallback].filter((account) => {
    if (ids.has(account.id)) return false;
    ids.add(account.id);
    return true;
  });
}

export class AccountRegistry {
  constructor(accounts = [], env = process.env, store = null) {
    this.envAccounts = accounts;
    this.env = env;
    this.store = store;
  }

  get accounts() {
    return this.list();
  }

  list() {
    const stored = this.store?.listAccounts?.() ?? [];
    const ids = new Set();
    return [...this.envAccounts, ...stored]
      .map((account, index) => normalizeAccount(account, index))
      .filter(Boolean)
      .filter((account) => {
        if (ids.has(account.id)) return false;
        ids.add(account.id);
        return true;
      });
  }

  isEnvManaged(id) {
    return this.envAccounts.some((account) => account.id === id);
  }

  listForProject(projectId = null) {
    const normalizedProjectId = normalizeId(projectId);
    return this.list().filter((account) => this.accountMatchesProject(account, normalizedProjectId));
  }

  listPublic(jobs = [], projectId = null) {
    return this.listForProject(projectId).map((account) =>
      this.publicAccount(account, jobs),
    );
  }

  publicAccount(account, jobs = []) {
    const usage = summarizeJobs(jobs, account.id);
    return {
      id: account.id,
      projectId: account.projectId ?? null,
      label: account.label,
      adapter: account.adapter,
      model: account.model,
      models: account.models ?? [],
      enabled: account.enabled,
      dailyTokenLimit: account.dailyTokenLimit,
      monthlyTokenLimit: account.monthlyTokenLimit,
      hasApiKey: Boolean(this.resolveSecret(account.apiKey, account.apiKeyEnv)),
      hasBaseUrl: Boolean(this.resolveSecret(account.baseUrl, account.baseUrlEnv)),
      usage,
    };
  }

  resolveSecret(value, envName) {
    return String(value ?? '').trim() || (envName ? String(this.env[envName] ?? '').trim() : '');
  }

  credentials(account) {
    if (!account) return {};
    return {
      apiKey: this.resolveSecret(account.apiKey, account.apiKeyEnv),
      baseUrl: this.resolveSecret(account.baseUrl, account.baseUrlEnv),
    };
  }

  accountMatchesProject(account, projectId = null) {
    const accountProjectId = normalizeId(account.projectId);
    const normalizedProjectId = normalizeId(projectId);
    if (!accountProjectId) return true;
    return Boolean(normalizedProjectId && accountProjectId === normalizedProjectId);
  }

  resolveForJob(job, jobs = []) {
    const projectId = normalizeId(job.projectId);
    const requested = normalizeId(job.accountId);
    if (requested) {
      const account = this.list().find((item) => item.id === requested);
      if (
        !account ||
        !this.accountMatchesProject(account, projectId) ||
        !account.enabled ||
        this.overLimit(account, jobs)
      ) {
        return null;
      }
      return account;
    }

    const adapter = String(job.adapter ?? '').trim().toLowerCase();
    const candidates = this.list()
      .filter((account) => this.accountMatchesProject(account, projectId))
      .filter((account) => account.enabled && account.adapter === adapter)
      .filter((account) => !this.overLimit(account, jobs))
      .sort((a, b) => {
        const aProjectId = normalizeId(a.projectId);
        const bProjectId = normalizeId(b.projectId);
        if (projectId && aProjectId === projectId && bProjectId !== projectId) return -1;
        if (projectId && bProjectId === projectId && aProjectId !== projectId) return 1;
        const aUsage = summarizeJobs(jobs, a.id).totalTokens;
        const bUsage = summarizeJobs(jobs, b.id).totalTokens;
        if (a.model && a.model === job.model && b.model !== job.model) return -1;
        if (b.model && b.model === job.model && a.model !== job.model) return 1;
        return aUsage - bUsage;
      });
    return candidates[0] ?? null;
  }

  overLimit(account, jobs = []) {
    const usage = summarizeJobs(jobs, account.id);
    if (account.monthlyTokenLimit && usage.totalTokens >= account.monthlyTokenLimit) {
      return true;
    }
    // Daily limit uses same persisted totals for now. It is conservative and
    // keeps the runner zero-dependency; reset by rotating account id or data dir.
    if (account.dailyTokenLimit && usage.totalTokens >= account.dailyTokenLimit) {
      return true;
    }
    return false;
  }
}
