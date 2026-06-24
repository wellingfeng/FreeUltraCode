/**
 * Builds the environment for a spawned agent CLI under tenant isolation.
 *
 * The runner process holds orchestration-wide secrets (every tenant's model
 * keys may sit in its own process.env). Inheriting process.env wholesale into a
 * spawned agent leaks all of them to whatever code that agent runs — across
 * tenants. To contain that, the agent gets a default-deny environment: only a
 * small allowlist of harmless system variables is carried over, every variable
 * that looks like a credential is dropped, and the caller then injects exactly
 * the one job's key(s) explicitly.
 */

/**
 * System variables safe to carry into an agent process. These are needed for a
 * CLI to find binaries, a home dir, temp space and locale — none are secrets.
 */
const SYSTEM_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TERM',
  'TMPDIR',
  'TEMP',
  'TMP',
  // Windows needs these for a process to start and resolve system paths.
  'SystemRoot',
  'SystemDrive',
  'windir',
  'COMSPEC',
  'PATHEXT',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
];

/**
 * Variable-name patterns that indicate a credential. Anything matching is never
 * carried over from the runner env, even if it also appears in the allowlist.
 */
const SECRET_NAME_PATTERN =
  /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|SESSION|COOKIE|PRIVATE|API[_-]?KEY|ACCESS[_-]?KEY)/i;

/** True when a variable name looks like it holds a secret. */
export function isLikelySecretEnvName(name) {
  return SECRET_NAME_PATTERN.test(String(name ?? ''));
}

/**
 * Build a default-deny base environment from a source env (defaults to the
 * runner's process.env). Only allowlisted, non-secret system variables survive.
 */
export function baseAgentEnv(sourceEnv = process.env) {
  const out = {};
  for (const name of SYSTEM_ENV_ALLOWLIST) {
    const value = sourceEnv[name];
    if (value === undefined || value === null) continue;
    if (isLikelySecretEnvName(name)) continue;
    out[name] = String(value);
  }
  return out;
}

/**
 * Assemble the final spawn environment for one job: the default-deny base, then
 * the explicitly injected per-job variables (the resolved adapter key, UGS_HOME,
 * etc.). Injected values win and may themselves be secrets — that is the point:
 * exactly this job's credential is allowed through, nothing else.
 */
export function buildAgentEnv(injected = {}, sourceEnv = process.env) {
  const env = baseAgentEnv(sourceEnv);
  for (const [name, value] of Object.entries(injected)) {
    if (value === undefined || value === null) continue;
    env[name] = String(value);
  }
  return env;
}
