import { beforeEach, describe, expect, it } from 'vitest';

import { searchSessions } from './sessionSearch';
import { invalidateSessionIndex, searchSessionsIndexed } from './sessionIndex';

interface FakeSession {
  title: string;
  updatedAt: number;
  messages: { role: string; text: string }[];
}

let sessions: Map<string, FakeSession>;

function makeReader(calls?: { count: number }) {
  return {
    async listSessions(_ws: string) {
      return [...sessions.entries()].map(([id, s]) => ({
        sessionId: id,
        title: s.title,
        updatedAt: s.updatedAt,
      }));
    },
    async getSession(_ws: string, sessionId: string) {
      if (calls) calls.count += 1;
      const s = sessions.get(sessionId);
      return s ? { messages: s.messages } : null;
    },
  };
}

beforeEach(() => {
  sessions = new Map();
  invalidateSessionIndex();
});

describe('sessionIndex', () => {
  it('returns the same hits as the brute-force search', async () => {
    sessions.set('s1', {
      title: '资源导入',
      updatedAt: 1000,
      messages: [{ role: 'user', text: '如何导入贴图资源？' }],
    });
    sessions.set('s2', {
      title: '物理引擎',
      updatedAt: 2000,
      messages: [{ role: 'user', text: '刚体碰撞与射线检测' }],
    });
    sessions.set('s3', {
      title: '导入导出',
      updatedAt: 3000,
      messages: [{ role: 'assistant', text: '导入模型到场景。' }],
    });

    const query = '导入贴图';
    const plain = await searchSessions(makeReader(), 'ws', query);
    const indexed = await searchSessionsIndexed(makeReader(), 'ws', query);
    expect(indexed.map((h) => h.sessionId)).toEqual(plain.map((h) => h.sessionId));
    expect(indexed.map((h) => h.score)).toEqual(plain.map((h) => h.score));
  });

  it('matches a latin query that is a substring of a longer token', async () => {
    sessions.set('s1', {
      title: '素材',
      updatedAt: 1000,
      messages: [{ role: 'user', text: 'we are importing fbx files' }],
    });
    sessions.set('s2', {
      title: '无关',
      updatedAt: 2000,
      messages: [{ role: 'user', text: 'nothing to see here' }],
    });

    const indexed = await searchSessionsIndexed(makeReader(), 'ws', 'import');
    expect(indexed.map((h) => h.sessionId)).toEqual(['s1']);
  });

  it('caches the workspace index across identical queries', async () => {
    sessions.set('s1', {
      title: '资源导入',
      updatedAt: 1000,
      messages: [{ role: 'user', text: '导入贴图' }],
    });
    const calls = { count: 0 };
    const reader = makeReader(calls);

    await searchSessionsIndexed(reader, 'ws', '导入');
    const afterFirst = calls.count;
    await searchSessionsIndexed(reader, 'ws', '导入');
    // No signature change → zero additional getSession reads.
    expect(calls.count).toBe(afterFirst);
  });

  it('reloads only changed sessions when the signature changes', async () => {
    sessions.set('s1', {
      title: '资源导入',
      updatedAt: 1000,
      messages: [{ role: 'user', text: '导入贴图' }],
    });
    const calls = { count: 0 };
    const reader = makeReader(calls);

    await searchSessionsIndexed(reader, 'ws', '导入');
    expect(calls.count).toBe(1);

    // A new session appears → only that session is loaded.
    sessions.set('s2', {
      title: '光照烘焙',
      updatedAt: 2000,
      messages: [{ role: 'user', text: '烘焙光照贴图' }],
    });
    const hits = await searchSessionsIndexed(reader, 'ws', '光照');
    expect(hits.map((h) => h.sessionId)).toEqual(['s2']);
    expect(calls.count).toBe(2);
  });

  it('excludes the live session id', async () => {
    sessions.set('s1', {
      title: '资源导入',
      updatedAt: 1000,
      messages: [{ role: 'user', text: '导入贴图' }],
    });
    const hits = await searchSessionsIndexed(makeReader(), 'ws', '导入', {
      excludeSessionId: 's1',
    });
    expect(hits).toEqual([]);
  });

  it('rebuilds from scratch after invalidation', async () => {
    sessions.set('s1', {
      title: '资源导入',
      updatedAt: 1000,
      messages: [{ role: 'user', text: '导入贴图' }],
    });
    const calls = { count: 0 };
    const reader = makeReader(calls);

    await searchSessionsIndexed(reader, 'ws', '导入');
    expect(calls.count).toBe(1);
    invalidateSessionIndex('ws');
    await searchSessionsIndexed(reader, 'ws', '导入');
    expect(calls.count).toBe(2);
  });

  it('returns no hits for a term with no indexable tokens', async () => {
    sessions.set('s1', {
      title: '资源导入',
      updatedAt: 1000,
      messages: [{ role: 'user', text: '导入贴图' }],
    });
    const hits = await searchSessionsIndexed(makeReader(), 'ws', '??');
    expect(hits).toEqual([]);
  });
});
