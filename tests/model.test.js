/**
 * 数据模型清洗测试（shared/model.js）
 * 这些函数决定「什么是合法数据」，迁移、导入、每一次写入都经过它们。
 */
import { describe, it, expect } from 'vitest';
import {
  ICON_PX,
  applySettingsPatch,
  buildFromLegacy,
  findByUrl,
  nextItemId,
  nextOrder,
  normalizeSharedItem,
  normalizeUrl,
  resolveGroupId,
  sanitizeBookmarks,
  sanitizeEngines,
  sanitizeFab,
  sanitizeGroups,
  sanitizeIcon,
  sanitizeNotebooks,
  sanitizeSettings,
} from '../extension/shared/model.js';

describe('normalizeUrl - 全项目唯一的判重依据', () => {
  it('只接受 http(s)', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBe('');
    expect(normalizeUrl('chrome://settings')).toBe('');
    expect(normalizeUrl('ftp://a.com')).toBe('');
    expect(normalizeUrl(123)).toBe('');
  });

  it('补根路径斜杠、主机名小写', () => {
    expect(normalizeUrl(' https://WWW.Baidu.com ')).toBe('https://www.baidu.com/');
  });

  it('findByUrl 把带与不带结尾斜杠视为同一链接（旧版取消收藏无反应的根因）', () => {
    const list = [{ id: 'a', url: 'https://www.baidu.com' }];
    expect(findByUrl(list, 'https://www.baidu.com/')?.id).toBe('a');
  });
});

describe('sanitizeBookmarks - 逐条过滤而不是整体丢弃', () => {
  const groups = sanitizeGroups([{ id: 'g1', name: 'G1', order: 10 }]);

  it('一条坏数据不影响其余书签', () => {
    const out = sanitizeBookmarks(
      [
        { id: 'ok', url: 'https://a.com', title: 'A', groupId: 'g1' },
        { url: 'https://no-id.com' },
        { id: 'bad-url', url: 'javascript:alert(1)' },
        null,
        'oops',
      ],
      groups
    );
    expect(out.map((b) => b.id)).toEqual(['ok']);
  });

  it('重复 id 只保留第一条', () => {
    const out = sanitizeBookmarks(
      [
        { id: 'x', url: 'https://a.com' },
        { id: 'x', url: 'https://b.com' },
      ],
      groups
    );
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe('https://a.com');
  });

  it('分组不存在的书签归入第一个分组（不会变成不可见）', () => {
    const out = sanitizeBookmarks([{ id: 'x', url: 'https://a.com', groupId: 'gone' }], groups);
    expect(out[0].groupId).toBe('g1');
  });

  it('非法图标与颜色被丢弃', () => {
    const [b] = sanitizeBookmarks(
      [{ id: 'x', url: 'https://a.com', icon: 'javascript:1', color: 'red;}' }],
      groups
    );
    expect(b.icon).toBeUndefined();
    expect(b.color).toBeUndefined();
  });

  it('resolveGroupId：存在则使用，否则回落到排序第一的分组', () => {
    const gs = sanitizeGroups([
      { id: 'b', name: 'B', order: 20 },
      { id: 'a', name: 'A', order: 10 },
    ]);
    expect(resolveGroupId(gs, 'b')).toBe('b');
    expect(resolveGroupId(gs, 'nope')).toBe('a');
  });

  it('nextOrder 只看同组书签', () => {
    const list = [
      { id: '1', groupId: 'a', order: 30 },
      { id: '2', groupId: 'b', order: 90 },
    ];
    expect(nextOrder(list, 'a')).toBe(40);
    expect(nextOrder(list, 'c')).toBe(10);
  });
});

describe('sanitizeSettings', () => {
  it('图标大小限制在 16~60', () => {
    expect(sanitizeSettings({ iconPx: 5 }).iconPx).toBe(ICON_PX.min);
    expect(sanitizeSettings({ iconPx: 99 }).iconPx).toBe(ICON_PX.max);
    expect(sanitizeSettings({ iconPx: 'x' }).iconPx).toBe(ICON_PX.def);
  });

  it('旧版 iconSize 迁移为像素值', () => {
    expect(sanitizeSettings({ iconSize: 'lg' }).iconPx).toBe(60);
  });

  it('已删除的设置项（主题、网格列数）不再保留', () => {
    const s = sanitizeSettings({ theme: 'light', columns: 8, version: '1.0.0' });
    expect('theme' in s).toBe(false);
    expect('columns' in s).toBe(false);
    expect('version' in s).toBe(false);
  });

  it('主题：默认深色，非法值回退深色，旧版 theme 字段不生效', () => {
    expect(sanitizeSettings({}).colorScheme).toBe('dark');
    expect(sanitizeSettings({ colorScheme: 'light' }).colorScheme).toBe('light');
    expect(sanitizeSettings({ colorScheme: 'system' }).colorScheme).toBe('system');
    expect(sanitizeSettings({ colorScheme: 'blue' }).colorScheme).toBe('dark');
    expect(sanitizeSettings({ theme: 'light' }).colorScheme).toBe('dark');
  });

  it('小组件：默认开启时钟 / 日期 / 农历，天气默认关闭', () => {
    expect(sanitizeSettings({}).widgets).toEqual({
      clock: true,
      clock24: true,
      date: true,
      lunar: true,
      weather: false,
      city: null,
    });
  });

  it('小组件：只保留布尔开关与合法城市', () => {
    const w = sanitizeSettings({
      widgets: { clock: false, weather: 'yes', city: { name: ' 杭州 ', admin: '浙江', lat: 30.29, lon: 120.16, extra: 1 } },
    }).widgets;
    expect(w.clock).toBe(false);
    expect(w.weather).toBe(false);
    expect(w.city).toEqual({ name: '杭州', admin: '浙江', lat: 30.29, lon: 120.16 });
    expect(sanitizeSettings({ widgets: { city: { name: 'X', lat: 200, lon: 0 } } }).widgets.city).toBeNull();
    expect(sanitizeSettings({ widgets: { city: { name: '', lat: 1, lon: 1 } } }).widgets.city).toBeNull();
  });

  it('检查更新：默认关闭，只有 true 才开启', () => {
    expect(sanitizeSettings({}).checkUpdate).toBe(false);
    expect(sanitizeSettings({ checkUpdate: true }).checkUpdate).toBe(true);
    expect(sanitizeSettings({ checkUpdate: 'yes' }).checkUpdate).toBe(false);
  });

  it('applySettingsPatch：值为 undefined 表示恢复默认', () => {
    const cur = sanitizeSettings({ cardOpacity: 0.8, radius: 20 });
    const next = applySettingsPatch(cur, { cardOpacity: undefined, radius: undefined });
    expect(next.cardOpacity).toBeUndefined();
    expect(next.radius).toBe(12);
  });

  it('分类名称显示方式：只接受 always / hover，缺省为 always', () => {
    expect(sanitizeSettings({}).groupNameMode).toBe('always');
    expect(sanitizeSettings({ groupNameMode: 'hover' }).groupNameMode).toBe('hover');
    expect(sanitizeSettings({ groupNameMode: 'x' }).groupNameMode).toBe('always');
  });

  it('Dock 去重并过滤非字符串', () => {
    expect(sanitizeSettings({ dockIds: ['a', 'a', 1, null, 'b'] }).dockIds).toEqual(['a', 'b']);
  });
});

describe('sanitizeFab', () => {
  it('缺省时启用（旧版缺失 fabEnabled 被误判为关闭）', () => {
    expect(sanitizeFab(undefined).enabled).toBe(true);
    expect(sanitizeFab({}).enabled).toBe(true);
    expect(sanitizeFab({ enabled: false }).enabled).toBe(false);
  });

  it('位置字段被夹到合法范围', () => {
    const f = sanitizeFab({ placement: { side: 'left', x: -5, y: 3 } });
    expect(f.placement).toEqual({ side: 'left', x: 0, y: 1 });
  });
});

describe('sanitizeEngines / sanitizeIcon / sanitizeNotebooks', () => {
  it('模板必须是含 %s 的 http(s) 地址；全部无效时回落到内置引擎', () => {
    const out = sanitizeEngines([
      { id: 'a', name: 'A', template: 'https://a.com/?q=%s' },
      { id: 'b', name: 'B', template: 'https://b.com/' },
      { id: 'c', name: 'C', template: 'javascript:%s' },
    ]);
    expect(out.map((e) => e.id)).toEqual(['a']);
    expect(sanitizeEngines([]).length).toBeGreaterThan(0);
    expect(sanitizeEngines([], { fallback: false })).toEqual([]);
  });

  it('图标只接受 data:image 或 http(s)', () => {
    expect(sanitizeIcon('data:image/png;base64,AAAA')).toBeTruthy();
    expect(sanitizeIcon('https://a.com/f.ico')).toBeTruthy();
    expect(sanitizeIcon('data:text/html;base64,AAAA')).toBeUndefined();
  });

  it('旧版单条 notebook 迁移为「默认笔记」', () => {
    const out = sanitizeNotebooks([], { legacy: { content: 'hello', updatedAt: 5 } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'default', name: '默认笔记', content: 'hello' });
  });

  it('列表为空时至少保留一条笔记', () => {
    expect(sanitizeNotebooks(undefined)).toHaveLength(1);
  });
});

describe('收纳箱条目', () => {
  it('Nav 偶发的 url / title 颠倒被纠正', () => {
    const it0 = normalizeSharedItem({ id: 1, url: '标题', title: 'https://real.example/p' });
    expect(it0.url).toBe('https://real.example/p');
    expect(it0.title).toBe('标题');
  });

  it('同一毫秒内生成的 id 不碰撞', () => {
    const ids = new Set(Array.from({ length: 500 }, () => nextItemId()));
    expect(ids.size).toBe(500);
  });
});

describe('buildFromLegacy - v1 单 key 数据转换', () => {
  it('完整转换并修复不变量', () => {
    const out = buildFromLegacy(
      {
        settings: {
          iconSize: 'sm',
          fabEnabled: false,
          backgroundDataUrl: 'data:image/png;base64,AAAA',
          dockIds: [],
          theme: 'dark',
        },
        bookmarks: [
          { id: 'b1', url: 'https://a.com', title: 'A', groupId: 'g1' },
          { id: 'b2', url: 'https://b.com' },
        ],
        groups: [{ id: 'g1', name: 'G1', order: 10 }],
        notebook: { content: 'old note' },
        __notebookCurrentId: 'default',
      },
      ['b1', 'gone']
    );
    expect(out.settings.iconPx).toBe(36);
    expect(out.fab.enabled).toBe(false);
    expect(out.background).toBe('data:image/png;base64,AAAA');
    // Dock 为空时用镜像恢复，并去掉不存在的书签
    expect(out.settings.dockIds).toEqual(['b1']);
    // 无分组的书签归入第一个分组
    expect(out.bookmarks.find((b) => b.id === 'b2').groupId).toBe('g1');
    expect(out.notebooks[0].content).toBe('old note');
    expect(out.settings.notebookCurrentId).toBe('default');
  });

  it('旧版缺少 fabEnabled 时视为开启', () => {
    expect(buildFromLegacy({ settings: {} }).fab.enabled).toBe(true);
  });
});
