/**
 * 存储层测试（shared/storage.js）
 *
 * 覆盖：v1 → v2 迁移、原子读-改-写、并发写入不互相覆盖、
 * 写入不变量（Dock / 分组引用）、业务错误不写入、读写失败必须 reject。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installFakeChrome } from './helpers/fakeChrome.js';

let st;
let fake;

beforeEach(async () => {
  fake = installFakeChrome();
  // 模块内有迁移状态与写入队列，每个用例都用全新实例
  vi.resetModules();
  st = await import('../extension/shared/storage.js');
});

afterEach(() => {
  delete globalThis.chrome;
});

const bm = (id, url, groupId = 'default') => ({ id, url, title: id, groupId, order: 10, createdAt: 1, updatedAt: 1 });

describe('迁移', () => {
  it('全新安装：写入默认数据与 meta', async () => {
    const data = await st.read();
    expect(data.groups).toHaveLength(1);
    expect(data.engines.length).toBeGreaterThan(0);
    expect(data.fab.enabled).toBe(true);
    expect(fake.data.get(st.META_KEY).schema).toBe(2);
  });

  it('v1 数据迁移到多 key，旧 key 保留作为回滚备份', async () => {
    const legacy = {
      settings: { radius: 20, dockIds: ['b1', 'gone'], fabEnabled: false },
      bookmarks: [bm('b1', 'https://a.com'), { id: 'broken' }],
      groups: [{ id: 'default', name: '未分组', order: 10 }],
    };
    fake.data.set('localGce', legacy);
    fake.data.set('gceDockIdsBackup', ['b1']);

    const data = await st.read();
    expect(data.settings.radius).toBe(20);
    expect(data.settings.dockIds).toEqual(['b1']);
    expect(data.bookmarks.map((b) => b.id)).toEqual(['b1']);
    expect(data.fab.enabled).toBe(false);
    expect(fake.data.get('localGce')).toEqual(legacy);
    expect(fake.data.has('gceDockIdsBackup')).toBe(false);
  });

  it('迁移是幂等的：已迁移的数据不会被旧 key 再次覆盖', async () => {
    fake.data.set('localGce', { settings: { radius: 20 } });
    await st.update(['settings'], ({ settings }) => ({ settings: { ...settings, radius: 5 } }));
    vi.resetModules();
    const again = await import('../extension/shared/storage.js');
    expect((await again.read(['settings'])).settings.radius).toBe(5);
  });
});

describe('update - 原子读-改-写', () => {
  it('只写回 mutator 返回的字段', async () => {
    await st.read();
    fake.setCalls.length = 0;
    await st.update(['engines'], ({ engines }) => ({ engines: engines.slice(0, 1) }));
    expect(fake.setCalls).toEqual([[st.KEYS.engines]]);
  });

  it('并发写入在锁内串行，互不覆盖', async () => {
    await Promise.all(
      ['a', 'b', 'c'].map((id) =>
        st.update(['bookmarks'], ({ bookmarks }) => ({
          bookmarks: [...bookmarks, bm(id, `https://${id}.com`)],
        }))
      )
    );
    const { bookmarks } = await st.read(['bookmarks']);
    expect(bookmarks.map((b) => b.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('mutator 返回空时不写入', async () => {
    await st.read();
    fake.setCalls.length = 0;
    await st.update(['bookmarks'], () => undefined);
    expect(fake.setCalls).toEqual([]);
  });

  it('UserError 原样抛出且不写入', async () => {
    await st.read();
    fake.setCalls.length = 0;
    await expect(
      st.update(['bookmarks'], () => {
        throw new st.UserError('该链接已存在');
      })
    ).rejects.toBeInstanceOf(st.UserError);
    expect(fake.setCalls).toEqual([]);
  });

  it('写回未声明的字段直接报错（防止误覆盖）', async () => {
    await expect(st.update(['engines'], () => ({ notebooks: [] }))).rejects.toThrow(/未在 fields 中声明/);
  });

  it('写入值同样经过清洗', async () => {
    const res = await st.update(['bookmarks'], () => ({
      bookmarks: [bm('ok', 'https://a.com'), { id: 'bad', url: 'javascript:1' }],
    }));
    expect(res.bookmarks.map((b) => b.id)).toEqual(['ok']);
  });
});

describe('写入不变量', () => {
  it('删除书签时同步清理 Dock', async () => {
    await st.update(['bookmarks'], ({ settings }) => ({
      bookmarks: [bm('a', 'https://a.com'), bm('b', 'https://b.com')],
      settings: { ...settings, dockIds: ['a', 'b'] },
    }));
    const res = await st.update(['bookmarks'], ({ bookmarks }) => ({
      bookmarks: bookmarks.filter((b) => b.id !== 'a'),
    }));
    expect(res.settings.dockIds).toEqual(['b']);
    expect(fake.data.get(st.KEYS.settings).dockIds).toEqual(['b']);
  });

  it('Dock 不能引用不存在的书签', async () => {
    const res = await st.update(['bookmarks'], ({ settings }) => ({
      settings: { ...settings, dockIds: ['nope'] },
    }));
    expect(res.settings.dockIds).toEqual([]);
  });

  it('删除分组后，组内残留书签归入剩余的第一个分组', async () => {
    await st.update(['bookmarks'], () => ({
      groups: [
        { id: 'g1', name: 'G1', order: 10 },
        { id: 'g2', name: 'G2', order: 20 },
      ],
      bookmarks: [bm('a', 'https://a.com', 'g2')],
    }));
    const res = await st.update(['bookmarks'], ({ groups }) => ({
      groups: groups.filter((g) => g.id !== 'g2'),
    }));
    expect(res.bookmarks[0].groupId).toBe('g1');
  });
});

describe('失败必须可见', () => {
  it('读取失败时 reject（而不是当作没有数据）', async () => {
    await st.read();
    fake.failGet = 1;
    await expect(st.read(['settings'])).rejects.toThrow(/READ_FAIL/);
  });

  it('写入失败时 reject，且之后仍可继续写入（锁未被毒化）', async () => {
    await st.read();
    fake.failSet = 1;
    await expect(st.update(['settings'], ({ settings }) => ({ settings: { ...settings, radius: 3 } }))).rejects.toThrow(
      /QUOTA/
    );
    await st.update(['settings'], ({ settings }) => ({ settings: { ...settings, radius: 4 } }));
    expect((await st.read(['settings'])).settings.radius).toBe(4);
  });
});

describe('pickChanges', () => {
  it('只提取本项目的 key 并转换为字段名', () => {
    const out = st.pickChanges({
      [st.KEYS.bookmarks]: { newValue: [1] },
      other: { newValue: 2 },
    });
    expect(out).toEqual({ bookmarks: [1] });
  });
});
