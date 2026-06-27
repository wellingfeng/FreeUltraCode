import { describe, expect, it } from 'vitest';

import {
  formatRecallHits,
  queryTerms,
  rankSessions,
  searchSessions,
  type SearchableSession,
  type SessionReader,
} from './sessionSearch';

function session(
  id: string,
  title: string,
  msgs: [string, string][],
  updatedAt = Date.now(),
): SearchableSession {
  return {
    workspaceId: 'ws',
    sessionId: id,
    title,
    updatedAt,
    messages: msgs.map(([role, text]) => ({ role, text })),
  };
}

describe('queryTerms', () => {
  it('extracts latin tokens of length >= 2', () => {
    expect(queryTerms('fix the API bug')).toEqual(expect.arrayContaining(['fix', 'the', 'api', 'bug']));
  });

  it('builds CJK bigrams', () => {
    const terms = queryTerms('资源导入');
    expect(terms).toEqual(expect.arrayContaining(['资源', '源导', '导入']));
  });

  it('returns empty for blank/short queries', () => {
    expect(queryTerms('')).toEqual([]);
    expect(queryTerms('a')).toEqual([]); // single latin char dropped
  });
});

describe('rankSessions', () => {
  const sessions = [
    session('s1', '资源导入流程', [
      ['user', '我们怎么处理资源导入'],
      ['assistant', '用 AssetPostprocessor 钩子处理导入'],
    ]),
    session('s2', '战斗系统设计', [
      ['user', '伤害公式怎么算'],
      ['assistant', '攻击力减防御力'],
    ]),
  ];

  it('finds the CJK-relevant session', () => {
    const hits = rankSessions(sessions, '资源导入');
    expect(hits[0]?.sessionId).toBe('s1');
    expect(hits[0]?.snippet).toContain('资源导入');
  });

  it('returns a context window around the anchor', () => {
    const hits = rankSessions(sessions, '资源导入', { window: 1 });
    expect(hits[0]?.window.length).toBeGreaterThan(0);
  });

  it('returns nothing for an unrelated query', () => {
    expect(rankSessions(sessions, '音频混响')).toEqual([]);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      session(`m${i}`, `导入笔记 ${i}`, [['user', '资源导入']], Date.now() - i * 1000),
    );
    expect(rankSessions(many, '资源导入', { limit: 3 })).toHaveLength(3);
  });

  it('breaks ties toward more recent sessions', () => {
    const older = session('old', '导入', [['user', '资源导入']], 1_000);
    const newer = session('new', '导入', [['user', '资源导入']], Date.now());
    const hits = rankSessions([older, newer], '资源导入');
    expect(hits[0]?.sessionId).toBe('new');
  });
});

describe('searchSessions (reader-backed)', () => {
  const reader: SessionReader = {
    listSessions: async () => [
      { id: 's1', title: '资源导入', updatedAt: Date.now() },
      { id: 'cur', title: '当前会话', updatedAt: Date.now() },
    ],
    getSession: async (_ws, sid) =>
      sid === 's1'
        ? { messages: [{ role: 'user', text: '资源导入怎么做' }] }
        : { messages: [{ role: 'user', text: '资源导入也提到了' }] },
  };

  it('excludes the current session', async () => {
    const hits = await searchSessions(reader, 'ws', '资源导入', { excludeSessionId: 'cur' });
    expect(hits.map((h) => h.sessionId)).toEqual(['s1']);
  });

  it('returns empty for an empty query', async () => {
    expect(await searchSessions(reader, 'ws', '')).toEqual([]);
  });
});

describe('formatRecallHits', () => {
  it('renders a no-result message when empty', () => {
    expect(formatRecallHits([])).toContain('未找到');
  });

  it('renders title, snippet and context for hits', () => {
    const hits = rankSessions(
      [session('s1', '资源导入', [['user', '资源导入怎么处理'], ['assistant', '用钩子']])],
      '资源导入',
    );
    const out = formatRecallHits(hits);
    expect(out).toContain('资源导入');
    expect(out).toContain('命中');
    expect(out).toContain('用户');
  });
});
