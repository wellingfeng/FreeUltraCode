import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const SECRET_PREFIX = 'enc:v1:';
const ACCOUNT_SECRET_FIELDS = ['apiKey', 'baseUrl'];
const PROJECT_SECRET_FIELDS = ['gitToken'];
const USER_SECRET_FIELDS = ['passwordHash'];
const VERIFICATION_SECRET_FIELDS = ['codeHash'];
const SESSION_SECRET_FIELDS = ['tokenHash'];

function deriveKey(secret) {
  return createHash('sha256').update(String(secret), 'utf8').digest();
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(SECRET_PREFIX);
}

/**
 * Tiny JSON-file job/workspace store. No external DB so the runner stays a
 * single `npm start` away from running on any box. Writes are serialized
 * through an in-memory queue to avoid interleaved file writes.
 */
export class JsonStore {
  /** @param {string} dataDir */
  constructor(dataDir) {
    this.file = join(dataDir, 'runner-state.json');
    this.keyFile = join(dataDir, 'runner-secret.key');
    this.state = {
      jobs: {},
      workspaces: {},
      projects: {},
      accounts: {},
      ledger: {},
      users: {},
      userEmails: {},
      verifications: {},
      sessions: {},
    };
    this.secretKey = null;
    this._writeChain = Promise.resolve();
    this._loaded = false;
  }

  async load() {
    await this._loadSecretKey();
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.state = {
        jobs: parsed.jobs ?? {},
        workspaces: parsed.workspaces ?? {},
        projects: parsed.projects ?? {},
        accounts: parsed.accounts ?? {},
        ledger: parsed.ledger ?? {},
        users: parsed.users ?? {},
        userEmails: parsed.userEmails ?? {},
        verifications: parsed.verifications ?? {},
        sessions: parsed.sessions ?? {},
      };
      this._migrateAccountSecrets();
      this._migrateProjectSecrets();
      this._migrateUserSecrets();
      this._migrateVerificationSecrets();
      this._migrateSessionSecrets();
      this._rebuildUserEmailIndex();
    } catch (err) {
      if (err && err.code !== 'ENOENT') throw err;
      // First boot: nothing persisted yet.
    }
    this._loaded = true;
    return this;
  }

  async _loadSecretKey() {
    const configured =
      process.env.UGS_RUNNER_SECRET_KEY || process.env.FUC_RUNNER_SECRET_KEY || '';
    if (configured.trim()) {
      this.secretKey = deriveKey(configured.trim());
      return;
    }
    try {
      const raw = await readFile(this.keyFile, 'utf8');
      this.secretKey = deriveKey(raw.trim());
      return;
    } catch (err) {
      if (err && err.code !== 'ENOENT') throw err;
    }
    const generated = randomBytes(32).toString('base64url');
    await mkdir(dirname(this.keyFile), { recursive: true });
    await writeFile(this.keyFile, `${generated}\n`, { encoding: 'utf8', mode: 0o600 });
    this.secretKey = deriveKey(generated);
  }

  _encrypt(value) {
    if (!value || isEncrypted(value)) return value;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.secretKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(String(value), 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${SECRET_PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
  }

  _decrypt(value) {
    if (!isEncrypted(value)) return value;
    const parts = value.slice(SECRET_PREFIX.length).split(':');
    if (parts.length !== 3) return '';
    try {
      const [ivRaw, tagRaw, ciphertextRaw] = parts;
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.secretKey,
        Buffer.from(ivRaw, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return '';
    }
  }

  _encryptFields(value, fields) {
    const next = { ...value };
    for (const field of fields) {
      if (typeof next[field] === 'string' && next[field]) {
        next[field] = this._encrypt(next[field]);
      }
    }
    return next;
  }

  _decryptFields(value, fields) {
    const next = { ...value };
    for (const field of fields) {
      if (typeof next[field] === 'string' && next[field]) {
        next[field] = this._decrypt(next[field]);
      }
    }
    return next;
  }

  _encryptAccount(account) {
    return this._encryptFields(account, ACCOUNT_SECRET_FIELDS);
  }

  _decryptAccount(account) {
    return this._decryptFields(account, ACCOUNT_SECRET_FIELDS);
  }

  _encryptProject(project) {
    return this._encryptFields(project, PROJECT_SECRET_FIELDS);
  }

  _decryptProject(project) {
    return this._decryptFields(project, PROJECT_SECRET_FIELDS);
  }

  _encryptUser(user) {
    return this._encryptFields(user, USER_SECRET_FIELDS);
  }

  _decryptUser(user) {
    return this._decryptFields(user, USER_SECRET_FIELDS);
  }

  _encryptVerification(verification) {
    return this._encryptFields(verification, VERIFICATION_SECRET_FIELDS);
  }

  _decryptVerification(verification) {
    return this._decryptFields(verification, VERIFICATION_SECRET_FIELDS);
  }

  _encryptSession(session) {
    return this._encryptFields(session, SESSION_SECRET_FIELDS);
  }

  _decryptSession(session) {
    return this._decryptFields(session, SESSION_SECRET_FIELDS);
  }

  _migrateAccountSecrets() {
    let changed = false;
    for (const [id, account] of Object.entries(this.state.accounts ?? {})) {
      const encrypted = this._encryptAccount(account);
      if (JSON.stringify(encrypted) !== JSON.stringify(account)) {
        this.state.accounts[id] = encrypted;
        changed = true;
      }
    }
    if (changed) void this._persist();
  }

  _migrateProjectSecrets() {
    let changed = false;
    for (const [id, project] of Object.entries(this.state.projects ?? {})) {
      const encrypted = this._encryptProject(project);
      if (JSON.stringify(encrypted) !== JSON.stringify(project)) {
        this.state.projects[id] = encrypted;
        changed = true;
      }
    }
    if (changed) void this._persist();
  }

  _migrateUserSecrets() {
    let changed = false;
    for (const [id, user] of Object.entries(this.state.users ?? {})) {
      const encrypted = this._encryptUser(user);
      if (JSON.stringify(encrypted) !== JSON.stringify(user)) {
        this.state.users[id] = encrypted;
        changed = true;
      }
    }
    if (changed) void this._persist();
  }

  _migrateVerificationSecrets() {
    let changed = false;
    for (const [id, verification] of Object.entries(this.state.verifications ?? {})) {
      const encrypted = this._encryptVerification(verification);
      if (JSON.stringify(encrypted) !== JSON.stringify(verification)) {
        this.state.verifications[id] = encrypted;
        changed = true;
      }
    }
    if (changed) void this._persist();
  }

  _migrateSessionSecrets() {
    let changed = false;
    for (const [id, session] of Object.entries(this.state.sessions ?? {})) {
      const encrypted = this._encryptSession(session);
      if (JSON.stringify(encrypted) !== JSON.stringify(session)) {
        this.state.sessions[id] = encrypted;
        changed = true;
      }
    }
    if (changed) void this._persist();
  }

  _rebuildUserEmailIndex() {
    const next = {};
    for (const user of Object.values(this.state.users ?? {}).map((item) =>
      this._decryptUser(item),
    )) {
      if (user.email && user.id) next[user.email] = user.id;
    }
    if (JSON.stringify(next) !== JSON.stringify(this.state.userEmails ?? {})) {
      this.state.userEmails = next;
      void this._persist();
    }
  }

  async _persist() {
    const snapshot = JSON.stringify(this.state, null, 2);
    this._writeChain = this._writeChain.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(this.file, snapshot, 'utf8');
    });
    return this._writeChain;
  }

  upsertJob(job) {
    this.state.jobs[job.id] = job;
    void this._persist();
    return job;
  }

  getJob(id) {
    return this.state.jobs[id] ?? null;
  }

  listJobs() {
    return Object.values(this.state.jobs).sort(
      (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
    );
  }

  upsertLedgerEntry(entry) {
    if (!entry?.id) return null;
    this.state.ledger ??= {};
    this.state.ledger[entry.id] = entry;
    void this._persist();
    return entry;
  }

  upsertLedgerEntries(entries) {
    const stored = [];
    for (const entry of entries ?? []) {
      const saved = this.upsertLedgerEntry(entry);
      if (saved) stored.push(saved);
    }
    return stored;
  }

  listLedgerEntries() {
    return Object.values(this.state.ledger ?? {}).sort(
      (a, b) => (b.at ?? 0) - (a.at ?? 0),
    );
  }

  upsertWorkspace(ws) {
    this.state.workspaces[ws.id] = ws;
    void this._persist();
    return ws;
  }

  getWorkspace(id) {
    return this.state.workspaces[id] ?? null;
  }

  listWorkspaces() {
    return Object.values(this.state.workspaces);
  }

  upsertProject(project) {
    this.state.projects ??= {};
    this.state.projects[project.id] = this._encryptProject(project);
    void this._persist();
    return project;
  }

  getProject(id, userId = null) {
    const project = this.state.projects?.[id] ?? null;
    if (!project) return null;
    const decrypted = this._decryptProject(project);
    if (userId && decrypted.userId !== userId) return null;
    return decrypted;
  }

  deleteProject(id, userId = null) {
    const existing = this.getProject(id, userId);
    if (!existing) return false;
    delete this.state.projects[id];
    void this._persist();
    return true;
  }

  listProjects(userId = null) {
    return Object.values(this.state.projects ?? {})
      .map((project) => this._decryptProject(project))
      .filter((project) => !userId || project.userId === userId)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  upsertAccount(account) {
    this.state.accounts ??= {};
    this.state.accounts[account.id] = this._encryptAccount(account);
    void this._persist();
    return account;
  }

  getAccount(id) {
    const account = this.state.accounts?.[id] ?? null;
    return account ? this._decryptAccount(account) : null;
  }

  deleteAccount(id) {
    const existed = Boolean(this.state.accounts[id]);
    delete this.state.accounts[id];
    if (existed) void this._persist();
    return existed;
  }

  listAccounts() {
    return Object.values(this.state.accounts ?? {}).map((account) =>
      this._decryptAccount(account),
    );
  }

  upsertUser(user) {
    this.state.users ??= {};
    this.state.userEmails ??= {};
    this.state.users[user.id] = this._encryptUser(user);
    if (user.email) this.state.userEmails[user.email] = user.id;
    void this._persist();
    return user;
  }

  getUser(id) {
    const user = this.state.users?.[id] ?? null;
    return user ? this._decryptUser(user) : null;
  }

  findUserByEmail(email) {
    const userId = this.state.userEmails?.[email] ?? null;
    return userId ? this.getUser(userId) : null;
  }

  listUsers() {
    return Object.values(this.state.users ?? {}).map((user) =>
      this._decryptUser(user),
    );
  }

  upsertVerification(verification) {
    this.state.verifications ??= {};
    this.state.verifications[verification.id] = this._encryptVerification(verification);
    void this._persist();
    return verification;
  }

  listVerifications(email = null, purpose = null) {
    return Object.values(this.state.verifications ?? {})
      .map((verification) => this._decryptVerification(verification))
      .filter((verification) => !email || verification.email === email)
      .filter((verification) => !purpose || verification.purpose === purpose)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }

  findLatestVerification(email, purpose) {
    return this.listVerifications(email, purpose)[0] ?? null;
  }

  consumeVerifications(email, purpose, now = Date.now()) {
    let changed = false;
    for (const verification of this.listVerifications(email, purpose)) {
      if (verification.consumed) continue;
      verification.consumed = true;
      verification.consumedAt = now;
      verification.updatedAt = now;
      this.state.verifications[verification.id] =
        this._encryptVerification(verification);
      changed = true;
    }
    if (changed) void this._persist();
  }

  upsertSession(session) {
    this.state.sessions ??= {};
    this.state.sessions[session.id] = this._encryptSession(session);
    void this._persist();
    return session;
  }

  getSession(id) {
    const session = this.state.sessions?.[id] ?? null;
    return session ? this._decryptSession(session) : null;
  }

  findSessionByTokenHash(tokenHash) {
    return (
      Object.values(this.state.sessions ?? {})
        .map((session) => this._decryptSession(session))
        .find((session) => session.tokenHash === tokenHash) ?? null
    );
  }

  listSessions(userId = null) {
    return Object.values(this.state.sessions ?? {})
      .map((session) => this._decryptSession(session))
      .filter((session) => !userId || session.userId === userId)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }
}
