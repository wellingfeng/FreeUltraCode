function numberFrom(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function readUsageContainer(value) {
  if (!value || typeof value !== 'object') return null;
  const raw = value;
  if (raw.usage && typeof raw.usage === 'object') return raw.usage;
  if (raw.token_usage && typeof raw.token_usage === 'object') return raw.token_usage;
  if (raw.total_token_usage && typeof raw.total_token_usage === 'object') {
    return raw.total_token_usage;
  }
  if (raw.response && typeof raw.response === 'object') {
    return readUsageContainer(raw.response);
  }
  if (raw.message && typeof raw.message === 'object') {
    return readUsageContainer(raw.message);
  }
  return raw;
}

export function emptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
    calls: 0,
  };
}

export function addUsage(a, b) {
  return {
    inputTokens: (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0),
    outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
    cachedInputTokens: (a?.cachedInputTokens ?? 0) + (b?.cachedInputTokens ?? 0),
    totalTokens: (a?.totalTokens ?? 0) + (b?.totalTokens ?? 0),
    calls: (a?.calls ?? 0) + (b?.calls ?? 0),
  };
}

export function normalizeUsage(value) {
  const raw = readUsageContainer(value);
  if (!raw || typeof raw !== 'object') return null;

  const promptDetails =
    raw.prompt_tokens_details && typeof raw.prompt_tokens_details === 'object'
      ? raw.prompt_tokens_details
      : {};
  const inputDetails =
    raw.input_tokens_details && typeof raw.input_tokens_details === 'object'
      ? raw.input_tokens_details
      : {};

  const inputTokens =
    numberFrom(raw.input_tokens) ||
    numberFrom(raw.prompt_tokens) ||
    numberFrom(raw.inputTokens);
  const outputTokens =
    numberFrom(raw.output_tokens) ||
    numberFrom(raw.completion_tokens) ||
    numberFrom(raw.outputTokens);
  const cacheRead =
    numberFrom(raw.cache_read_input_tokens) ||
    numberFrom(raw.cache_read_tokens) ||
    numberFrom(raw.cached_input_tokens) ||
    numberFrom(raw.cached_tokens) ||
    numberFrom(promptDetails.cached_tokens) ||
    numberFrom(inputDetails.cached_tokens);
  const cacheCreation =
    numberFrom(raw.cache_creation_input_tokens) ||
    numberFrom(raw.cache_creation_tokens);
  const cachedInputTokens = cacheRead + cacheCreation;
  const explicitTotal =
    numberFrom(raw.total_tokens) || numberFrom(raw.totalTokens);
  const anthropicStyleCached =
    raw.cache_read_input_tokens !== undefined ||
    raw.cache_creation_input_tokens !== undefined ||
    raw.cache_read_tokens !== undefined ||
    raw.cache_creation_tokens !== undefined;
  const totalTokens =
    explicitTotal ||
    inputTokens + outputTokens + (anthropicStyleCached ? cachedInputTokens : 0);

  if (!inputTokens && !outputTokens && !cachedInputTokens && !totalTokens) {
    return null;
  }
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens,
    calls: numberFrom(raw.calls) || 1,
  };
}

function parseJsonLine(line) {
  const trimmed = line.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function usageFromText(text) {
  let usage = emptyUsage();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const parsed = parseJsonLine(line);
    const current = normalizeUsage(parsed);
    if (current) usage = addUsage(usage, current);
  }
  return usage.calls > 0 ? usage : null;
}

export function summarizeJobs(jobs, accountId = null) {
  let totals = emptyUsage();
  let lastUsedAt = null;
  for (const job of jobs) {
    if (accountId && job.accountId !== accountId) continue;
    const usage = job.usage ?? job.result?.usage;
    if (!usage) continue;
    totals = addUsage(totals, usage);
    lastUsedAt = Math.max(lastUsedAt ?? 0, job.updatedAt ?? job.createdAt ?? 0);
  }
  return { ...totals, lastUsedAt };
}

function positiveMs(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function usageForJob(job) {
  return normalizeUsage(job?.usage ?? job?.result?.usage) ?? emptyUsage();
}

export function usageLedgerEntriesForJob(job) {
  if (!job?.id) return [];
  const at = job.finishedAt ?? job.updatedAt ?? job.createdAt ?? Date.now();
  const common = {
    at,
    jobId: job.id,
    userId: job.userId ?? null,
    projectId: job.projectId ?? null,
    accountId: job.accountId ?? null,
    adapter: job.adapter ?? null,
    model: job.model ?? null,
    status: job.status ?? null,
  };
  const entries = [];
  const hasRuntime =
    job.runtimeMs !== undefined ||
    (job.startedAt !== undefined && (job.finishedAt !== undefined || job.updatedAt !== undefined));
  const runtimeMs =
    positiveMs(job.runtimeMs) ||
    positiveMs((job.finishedAt ?? job.updatedAt) - (job.startedAt ?? job.createdAt));
  if (hasRuntime) {
    entries.push({
      id: `ledger_${job.id}_runtime`,
      type: 'runtime',
      ...common,
      runtimeMs,
    });
  }
  const usage = usageForJob(job);
  if (usage.calls > 0 || usage.totalTokens > 0) {
    entries.push({
      id: `ledger_${job.id}_model_tokens`,
      type: 'model_tokens',
      ...common,
      usage,
    });
  }
  return entries;
}

export function summarizeLedger(entries, accountId = null) {
  let totals = emptyUsage();
  let runtimeMs = 0;
  let lastUsedAt = null;
  const jobIds = new Set();
  for (const entry of entries ?? []) {
    if (accountId && entry.accountId !== accountId) continue;
    if (entry.jobId) jobIds.add(entry.jobId);
    lastUsedAt = Math.max(lastUsedAt ?? 0, entry.at ?? 0);
    if (entry.type === 'model_tokens') {
      totals = addUsage(totals, entry.usage ?? emptyUsage());
    } else if (entry.type === 'runtime') {
      runtimeMs += positiveMs(entry.runtimeMs);
    }
  }
  return {
    ...totals,
    runtimeMs,
    runtimeMinutes: runtimeMs > 0 ? Math.ceil(runtimeMs / 60_000) : 0,
    jobs: jobIds.size,
    lastUsedAt,
  };
}
