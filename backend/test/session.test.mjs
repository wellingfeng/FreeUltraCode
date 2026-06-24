import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueSession, refreshSession, revokeSession, verifyAccessToken } from '../src/session.mjs';

function makeStore() {
  const state = { sessions: new Map(), users: new Map() };
  return {
    upsertSession(session) {
      state.sessions.set(session.id, session);
      return session;
    },
    findSessionByTokenHash(hash) {
      return [...state.sessions.values()].find((session) => session.tokenHash === hash) ?? null;
    },
    getUser(id) {
      return state.users.get(id) ?? null;
    },
    addUser(user) {
      state.users.set(user.id, user);
    },
  };
}

test('sessions issue access and refresh tokens', () => {
  const store = makeStore();
  const user = { id: 'usr_1', email: 'a@example.com', status: 'active' };
  store.addUser(user);
  const issued = issueSession(store, user, { jwtSecret: 'secret', now: 1000 });
  assert.ok(issued.accessToken);
  assert.ok(issued.refreshToken);
  assert.equal(verifyAccessToken(issued.accessToken, 'secret', { now: 2000 }).sub, 'usr_1');
  const refreshed = refreshSession(store, issued.refreshToken, {
    jwtSecret: 'secret',
    now: 2000,
  });
  assert.equal(refreshed.user.email, 'a@example.com');
});

test('revoked refresh tokens stop working', () => {
  const store = makeStore();
  const user = { id: 'usr_1', email: 'a@example.com', status: 'active' };
  store.addUser(user);
  const issued = issueSession(store, user, { jwtSecret: 'secret' });
  assert.equal(revokeSession(store, issued.refreshToken), true);
  assert.equal(refreshSession(store, issued.refreshToken, { jwtSecret: 'secret' }), null);
});
