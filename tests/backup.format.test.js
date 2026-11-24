/**
 * 备份格式契约测试
 *
 * 这是「不可变契约」：导入导出格式一旦变化，用户的旧备份、
 * 以及与旧版本 / 手机 Nav 之间的互导都会失效。因此用测试把格式钉死。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installFakeChrome } from './helpers/fakeChrome.js';

let backup;
let storage;

beforeEach(async () => {
  installFakeChrome();
  vi.resetModules();
  backup = await import('../extension/src/core/utils/backup.ts');
  storage = await import('../extension/shared/storage.js');
});

afterEach(() => {
  delete globalThis.chrome;
});

const BACKUP_TYPE = 'local-gce-backup';
const LEGACY_WETAB_TYPE = 'local-wetab-backup';

describe('备份信封格式（不可变契约）', () => {
  it('parseBackup 接受 local-gce-backup 信封', async () => {
    const text = JSON.stringify({
      type: BACKUP_TYPE,
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      payload: { settings: { theme: 'dark' }, bookmarks: [], groups: [], engines: [] },
    });
    const preview = await backup.parseBackup(text);
    expect(preview.hasSettings).toBe(true);
  });

  it('parseBackup 仍接受旧版 wetab 信封（向后兼容）', async () => {
    const text = JSON.stringify({
      type: LEGACY_WETAB_TYPE,
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      payload: { settings: { theme: 'dark' }, bookmarks: [], groups: [], engines: [] },
    });
    const preview = await backup.parseBackup(text);
    expect(preview.hasSettings).toBe(true);
  });

  it('parseBackup 拒绝无法识别的结构', async () => {
    await expect(backup.parseBackup('{"foo":1}')).rejects.toThrow(/不支持/);
  });

  it('parseBackup 对非法 JSON 给出明确错误', async () => {
    await expect(backup.parseBackup('not-json')).rejects.toThrow(/格式无效/);
  });

  it('缺少 payload 时报错', async () => {
    const text = JSON.stringify({ type: BACKUP_TYPE, version: '1.0.0' });
    await expect(backup.parseBackup(text)).rejects.toThrow(/缺少数据内容/);
  });
});

describe('导入字段契约（与 Nav / 旧备份互导）', () => {
  const buildBackup = (payload) => JSON.stringify({
    type: BACKUP_TYPE,
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    payload,
  });

  it('统计各类别数量，字段名固定', async () => {
    const text = buildBackup({
      settings: { theme: 'light', columns: 8 },
      engines: [{ id: 'baidu', name: '百度', template: 'https://b.com/s?wd=%s' }],
      bookmarks: [
        { id: 'b1', title: 'A', url: 'https://a.example', groupId: 'default', order: 10 },
        { id: 'b2', title: 'B', url: 'https://b.example', groupId: 'default', order: 20 },
      ],
      groups: [{ id: 'default', name: '未分组', order: 10 }],
      notebooks: [{ id: 'n1', name: '笔记', content: 'x', updatedAt: 1, images: [] }],
      sharedItems: [{ id: 1, url: 'https://c.example', title: 'C', createdAt: 1 }],
    });
    const p = await backup.parseBackup(text);
    expect(p.bookmarks).toBe(2);
    expect(p.groups).toBe(1);
    expect(p.notebooks).toBe(1);
    expect(p.sharedItems).toBe(1);
    expect(p.hasEngines).toBe(true);
  });

  it('Nav 分享条目（url/title 颠倒）导入时被自动纠正', async () => {
    const text = buildBackup({
      sharedItems: [{ id: 1, url: '这是一段标题', title: 'https://real.example/page', createdAt: 1 }],
    });
    const res = await backup.importBackup(text);
    expect(res.sharedItems[0]).toMatchObject({ url: 'https://real.example/page', title: '这是一段标题' });
  });

  it('备份中缺失的类别不会导致报错', async () => {
    const text = buildBackup({ settings: { theme: 'dark' } });
    const p = await backup.parseBackup(text);
    expect(p.bookmarks).toBe(0);
    expect(p.sharedItems).toBe(0);
  });

  it('笔记图片以 dataUrl 内联在备份中（保证可移植）', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const text = buildBackup({
      notebooks: [{
        id: 'n1', name: '带图笔记', content: '', updatedAt: 1,
        images: [{ id: 'img-1', name: 'a.png', mime: 'image/png', size: 10, createdAt: 1, dataUrl: png }],
      }],
    });
    const parsed = JSON.parse(text);
    expect(parsed.payload.notebooks[0].images[0].dataUrl).toBe(png);
    const p = await backup.parseBackup(text);
    expect(p.notebooks).toBe(1);
  });
});

describe('导出 → 导入往返', () => {
  const buildBackup = (payload) =>
    JSON.stringify({ type: BACKUP_TYPE, version: '1.0.0', exportedAt: new Date().toISOString(), payload });

  it('导出信封结构固定；背景图与悬浮按钮开关内联在 settings 中', async () => {
    await storage.update(['background', 'fab'], ({ fab }) => ({
      background: 'data:image/png;base64,AAAA',
      fab: { ...fab, enabled: false },
    }));
    const parsed = JSON.parse(await (await backup.exportBackup()).text());
    expect(parsed.type).toBe(BACKUP_TYPE);
    expect(parsed.version).toBe('1.0.0');
    expect(typeof parsed.exportedAt).toBe('string');
    expect(Object.keys(parsed.payload).sort()).toEqual(
      ['bookmarks', 'engines', 'groups', 'notebooks', 'settings', 'sharedItems'].sort()
    );
    expect(parsed.payload.settings.backgroundDataUrl).toBe('data:image/png;base64,AAAA');
    expect(parsed.payload.settings.fabEnabled).toBe(false);
  });

  it('往返后数据一致', async () => {
    await storage.update(['bookmarks'], ({ groups }) => ({
      bookmarks: [{ id: 'b1', url: 'https://a.com/', title: 'A', groupId: groups[0].id, order: 10, createdAt: 1, updatedAt: 1 }],
    }));
    const text = await (await backup.exportBackup()).text();
    await backup.clearData({ bookmarks: true });
    await backup.importBackup(text);
    const { bookmarks } = await storage.read(['bookmarks']);
    expect(bookmarks.map((b) => b.id)).toEqual(['b1']);
  });

  it('备份中只有部分设置时，其余设置保持当前值（旧版会被重置为默认）', async () => {
    await storage.update(['settings'], ({ settings }) => ({
      settings: { ...settings, defaultSearchId: 'google', radius: 20 },
    }));
    await backup.importBackup(buildBackup({ settings: { iconPx: 40 } }));
    const { settings } = await storage.read(['settings']);
    expect(settings).toMatchObject({ iconPx: 40, defaultSearchId: 'google', radius: 20 });
  });

  it('坏书签逐条过滤；与现有书签网址相同的跳过', async () => {
    await storage.update(['bookmarks'], () => ({
      bookmarks: [{ id: 'mine', url: 'https://a.com', title: 'A', groupId: 'default', order: 10, createdAt: 1, updatedAt: 1 }],
    }));
    await backup.importBackup(
      buildBackup({
        bookmarks: [
          { id: 'dup', url: 'https://a.com/', title: 'dup' },
          { id: 'bad', url: 'javascript:alert(1)' },
          { title: 'no id', url: 'https://c.com' },
          { id: 'new', url: 'https://b.com', title: 'B' },
        ],
      })
    );
    const { bookmarks } = await storage.read(['bookmarks']);
    expect(bookmarks.map((b) => b.id).sort()).toEqual(['mine', 'new']);
  });

  it('只导入勾选的类别', async () => {
    await backup.importBackup(
      buildBackup({
        settings: { radius: 3 },
        sharedItems: [{ id: 9, url: 'https://x.com', title: 'X', createdAt: 1 }],
      }),
      { categories: ['sharedItems'] }
    );
    const data = await storage.read(['settings', 'sharedItems']);
    expect(data.settings.radius).toBe(12);
    expect(data.sharedItems).toHaveLength(1);
  });
});

describe('清空数据', () => {
  it('清空分组：书签全部归入「未分组」，不会变成不可见', async () => {
    await storage.update(['bookmarks'], () => ({
      groups: [{ id: 'g1', name: 'G1', order: 10 }],
      bookmarks: [{ id: 'b', url: 'https://a.com', title: 'A', groupId: 'g1', order: 10, createdAt: 1, updatedAt: 1 }],
    }));
    const res = await backup.clearData({ groups: true });
    expect(res.groups.map((g) => g.id)).toEqual(['default']);
    expect(res.bookmarks[0].groupId).toBe('default');
  });

  it('清空搜索引擎：恢复内置引擎而不是留空', async () => {
    const res = await backup.clearData({ engines: true });
    expect(res.engines.length).toBeGreaterThan(0);
    expect(res.engines.every((e) => e.builtin)).toBe(true);
  });
});
