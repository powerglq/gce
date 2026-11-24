/**
 * favicon 体积瘦身测试
 *
 * 背景：Bookmark.icon 历史上「抓到多大存多大」，多尺寸 .ico 可达 300KB。
 * icon 存在 localGce 里 → 每次写入都要序列化整个 root → 体积直接转化为写入延迟。
 *
 * 分工说明：
 * 本模块只负责「判定 / 批量 / 提交 / 失败隔离」，
 * 真正的降采样在 shared/favicon.js（依赖 createImageBitmap / OffscreenCanvas，无法在 node 中执行）。
 * 因此这里 mock 掉 normalizeFaviconBlob，聚焦本模块自身的逻辑。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const normalizeMock = vi.fn();

vi.mock('../extension/shared/favicon.js', async (importOriginal) => ({
  ...(await importOriginal()),
  normalizeFaviconBlob: (...args) => normalizeMock(...args),
}));

const {
  shrinkFaviconDataUrl,
  runIconShrinkOnce,
  needsShrink,
  SHRINK_THRESHOLD_BASE64,
  MAX_PER_SESSION,
} = await import('../extension/src/core/utils/iconShrink.ts');

/** 造一个「超标」的 dataURL（长度够大即可，内容不参与判断） */
function oversized(tag = 'x') {
  return `data:image/png;base64,${tag.repeat(SHRINK_THRESHOLD_BASE64 + 500)}`;
}
/** 造一个「已达标」的 dataURL */
function small() {
  return `data:image/png;base64,${'y'.repeat(1000)}`;
}

beforeEach(() => {
  normalizeMock.mockReset();
  // 默认：成功返回一个小图标
  normalizeMock.mockResolvedValue('data:image/png;base64,SMALL');
});

describe('needsShrink - 判定阈值', () => {
  it('小图标不处理（避免无谓 CPU 与写入）', () => {
    expect(needsShrink(small())).toBe(false);
  });

  it('超过阈值的大图标需要处理', () => {
    expect(needsShrink(oversized())).toBe(true);
  });

  it('非 dataURL 不处理', () => {
    expect(needsShrink('https://example.com/f.png')).toBe(false);
  });

  it('undefined / null / 数字 不处理', () => {
    expect(needsShrink(undefined)).toBe(false);
    expect(needsShrink(null)).toBe(false);
    expect(needsShrink(123)).toBe(false);
  });
});

describe('shrinkFaviconDataUrl - 委托与保护', () => {
  it('达标图标直接返回 null，不调用降采样', async () => {
    await expect(shrinkFaviconDataUrl(small())).resolves.toBeNull();
    expect(normalizeMock).not.toHaveBeenCalled();
  });

  it('超标图标走降采样并返回新值', async () => {
    const out = await shrinkFaviconDataUrl(oversized());
    expect(normalizeMock).toHaveBeenCalledTimes(1);
    expect(out).toBe('data:image/png;base64,SMALL');
  });

  it('降采样失败（返回空串）时返回 null —— 绝不把原图标改成空', async () => {
    normalizeMock.mockResolvedValue('');
    await expect(shrinkFaviconDataUrl(oversized())).resolves.toBeNull();
  });

  it('降采样抛异常时返回 null（不向上冒泡）', async () => {
    normalizeMock.mockRejectedValue(new Error('decode fail'));
    await expect(shrinkFaviconDataUrl(oversized())).resolves.toBeNull();
  });

  it('降采样结果没有变小时保持原值（避免无谓写入）', async () => {
    const big = oversized();
    // 模拟「结果反而更大」
    normalizeMock.mockResolvedValue(`${big}EXTRA`);
    await expect(shrinkFaviconDataUrl(big)).resolves.toBeNull();
  });

  it('无法解析的 dataURL 返回 null（不进入降采样）', async () => {
    const broken = `data:image/png;base64,!!!not-base64!!!${'A'.repeat(SHRINK_THRESHOLD_BASE64)}`;
    await expect(shrinkFaviconDataUrl(broken)).resolves.toBeNull();
    expect(normalizeMock).not.toHaveBeenCalled();
  });
});

describe('runIconShrinkOnce - 批量治理', () => {
  it('没有超大图标时不写入任何数据', async () => {
    const commit = vi.fn();
    const root = { bookmarks: [{ id: 'a', icon: small() }], engines: [] };
    const changed = await runIconShrinkOnce(async () => root, commit);
    expect(changed).toBe(0);
    expect(commit).not.toHaveBeenCalled();
  });

  it('root 为空 / 读取失败时安全返回', async () => {
    const commit = vi.fn();
    expect(await runIconShrinkOnce(async () => undefined, commit)).toBe(0);
    expect(await runIconShrinkOnce(async () => { throw new Error('read fail'); }, commit)).toBe(0);
    expect(commit).not.toHaveBeenCalled();
  });

  it('超大图标被处理并提交，且不修改入参对象', async () => {
    const big = oversized();
    const root = { bookmarks: [{ id: 'a', icon: big }, { id: 'b', icon: small() }], engines: [] };
    let committed = null;
    const changed = await runIconShrinkOnce(async () => root, async (next) => { committed = next; });

    expect(changed).toBe(1);
    expect(committed).toBeTruthy();
    expect(committed.bookmarks[0].icon).toBe('data:image/png;base64,SMALL');
    // 未超标项原样保留
    expect(committed.bookmarks[1].icon).toBe(root.bookmarks[1].icon);
    // 入参未被污染
    expect(root.bookmarks[0].icon).toBe(big);
  });

  it('单个条目失败不影响其余条目', async () => {
    normalizeMock
      .mockRejectedValueOnce(new Error('bad one'))
      .mockResolvedValue('data:image/png;base64,OK');
    const root = {
      bookmarks: [{ id: 'a', icon: oversized('a') }, { id: 'b', icon: oversized('b') }],
      engines: [],
    };
    const changed = await runIconShrinkOnce(async () => root, async () => {});
    expect(changed).toBe(1);
  });

  it('提交失败时返回 0 且不抛异常（维护任务绝不影响启动）', async () => {
    const root = { bookmarks: [{ id: 'a', icon: oversized() }], engines: [] };
    const changed = await runIconShrinkOnce(
      async () => root,
      async () => { throw new Error('storage fail'); },
    );
    expect(changed).toBe(0);
  });

  it('只处理单次上限内的数量，不会一次卡死', async () => {
    const n = MAX_PER_SESSION + 20;
    const bookmarks = Array.from({ length: n }, (_, i) => ({ id: `b${i}`, icon: oversized(String(i % 10)) }));
    const root = { bookmarks, engines: [] };
    const changed = await runIconShrinkOnce(async () => root, async () => {});
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThanOrEqual(MAX_PER_SESSION);
  }, 30000);

  it('engines 的图标同样被处理', async () => {
    const root = { bookmarks: [], engines: [{ id: 'e1', icon: oversized() }] };
    let committed = null;
    const changed = await runIconShrinkOnce(async () => root, async (next) => { committed = next; });
    expect(changed).toBe(1);
    expect(committed.engines[0].icon).toBe('data:image/png;base64,SMALL');
  });
});
