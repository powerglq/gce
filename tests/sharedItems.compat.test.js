/**
 * 共享条目（收纳箱）与 Nav 分享数据、备份格式的兼容性测试
 *
 * 这些用例是「契约测试」：锁定 SharedItem 的字段与 id 行为，
 * 防止后续优化破坏与手机 Nav 分享数据、以及导入导出备份的兼容。
 */
import { describe, it, expect } from 'vitest';
import { normalizeSharedItem as normalizeItem } from '../extension/shared/model.js';
import { categorizeUrl } from '../extension/src/core/store/useSharedItems.ts';

const mod = { normalizeItem, categorizeUrl };

describe('SharedItem 结构契约', () => {
  it('id 必须是 number（Nav 分享数据与备份都依赖这一点）', () => {
    const item = mod.normalizeItem({ url: 'https://a.example', title: 'A' });
    expect(typeof item.id).toBe('number');
  });

  it('Nav 传来的 id 被原样保留', () => {
    const navId = 1700000000000;
    const item = mod.normalizeItem({ id: navId, url: 'https://a.example', title: 'A' });
    expect(item.id).toBe(navId);
  });

  it('缺少 id 时自动生成，且与 Date.now() 同量级（不放大数值范围）', () => {
    const before = Date.now();
    const item = mod.normalizeItem({ url: 'https://a.example', title: 'A' });
    const after = Date.now();
    // 允许极少数因单调递增而 +1 的溢出，但不能是数量级放大
    expect(item.id).toBeGreaterThanOrEqual(before);
    expect(item.id).toBeLessThanOrEqual(after + 1);
  });

  it('同一毫秒内连续生成不碰撞（修复前会撞）', () => {
    const ids = new Set();
    for (let i = 0; i < 500; i++) {
      ids.add(mod.normalizeItem({ url: `https://a${i}.example`, title: 'A' }).id);
    }
    expect(ids.size).toBe(500);
  });

  it('字段缺失时补默认值，不产生 undefined', () => {
    const item = mod.normalizeItem({});
    expect(item.url).toBe('');
    expect(item.title).toBe('');
    expect(item.description).toBe('');
    expect(item.thumbnail).toBe('');
    expect(item.source).toBe('');
    expect(item.contentType).toBe('url');
    expect(typeof item.createdAt).toBe('number');
  });

  it('contentType 保留 Nav 传入的原值', () => {
    expect(mod.normalizeItem({ contentType: 'wechat' }).contentType).toBe('wechat');
    expect(mod.normalizeItem({ contentType: 'text' }).contentType).toBe('text');
  });
});

describe('分类函数（Nav 分享内容识别）', () => {
  it('识别视频 / 代码 / 商品 / 公众号 / 文章 / 文档', () => {
    expect(mod.categorizeUrl('https://www.bilibili.com/video/1')).toBe('视频');
    expect(mod.categorizeUrl('https://github.com/foo/bar')).toBe('代码');
    expect(mod.categorizeUrl('https://item.jd.com/1.html')).toBe('商品');
    expect(mod.categorizeUrl('https://mp.weixin.qq.com/s/abc')).toBe('公众号');
    expect(mod.categorizeUrl('https://zhihu.com/question/1')).toBe('文章');
    expect(mod.categorizeUrl('https://example.com/doc.pdf')).toBe('文档');
    expect(mod.categorizeUrl('https://example.com/')).toBe('链接');
  });
});

describe('存储契约', () => {
  it('sharedItems 数组按 id 去重合并（导入时的语义）', () => {
    const cur = [{ id: 1, url: 'https://a', title: 'A' }, { id: 2, url: 'https://b', title: 'B' }];
    const incoming = [{ id: 2, url: 'https://b', title: 'B2' }, { id: 3, url: 'https://c', title: 'C' }];
    const map = new Map();
    for (const e of cur) map.set(e.id, e);
    for (const e of incoming) map.set(e.id, e);
    const merged = Array.from(map.values());
    expect(merged).toHaveLength(3);
    expect(merged.find((e) => e.id === 2).title).toBe('B2');
  });
});
