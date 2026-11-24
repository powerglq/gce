/**
 * favicon 体积治理
 *
 * 为什么需要：Bookmark.icon 历史上是「抓到多大存多大」的 base64（上限 2MB）。
 * 多尺寸 .ico 常见 50~300KB，apple-touch-icon 10~20KB。
 * 书签图标以 base64 存在 gce.bookmarks 中，每次改动书签都要整体序列化该 key，
 * 体积直接转化为写入延迟与跨标签页同步开销。
 *
 * 现在的抓取流程已做降采样（见 shared/favicon.js），但**存量数据不会自动变小**。
 * 本模块在启动时对超阈值的存量图标做一次性就地瘦身。
 *
 * 策略：
 * - 只处理明显超标的（base64 长度 > 阈值），避免无谓的 CPU 开销
 * - 分批处理，避免单次启动卡顿；可中断
 * - 单个失败不改写原值；提交由调用方按 id 合并（不覆盖期间的其它改动）
 * - 不动格式契约：icon 仍是 dataURL 字符串，导入导出与 Nav 兼容完全不受影响
 */
import { dataURLToBlob } from './image';
import { normalizeFaviconBlob } from '../../../shared/favicon.js';
import { LOGI, LOGW } from '../../../shared/log.js';

/** base64 长度阈值。128×128 PNG 约 3~9KB(base64 约 4~12KB)，取 12KB 作为「已达标」线 */
const SHRINK_THRESHOLD_BASE64 = 12 * 1024;

/** 单次启动最多处理多少个（避免老用户第一次打开就卡住） */
const MAX_PER_SESSION = 60;

/** 每处理一个后让出主线程，保持界面响应 */
const YIELD_EVERY = 5;

/** 只关心 id 与 icon；其余字段原样保留 */
type IconItem = { id: string; icon?: string; [k: string]: unknown };

function needsShrink(dataUrl: unknown): dataUrl is string {
  return typeof dataUrl === 'string'
    && dataUrl.startsWith('data:image/')
    && dataUrl.length > SHRINK_THRESHOLD_BASE64;
}

function yieldToUI(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/**
 * 缩减单个 dataURL 图标
 * @returns 新的 dataURL；无需处理或失败时返回 null（失败不改写原值）
 */
export async function shrinkFaviconDataUrl(dataUrl: string): Promise<string | null> {
  if (!needsShrink(dataUrl)) return null;
  let blob: Blob;
  try {
    blob = dataURLToBlob(dataUrl);
  } catch {
    return null;
  }
  try {
    const out = await normalizeFaviconBlob(blob);
    if (!out) return null;
    // 没有实际变小就保持原值，避免无谓写入
    if (out.length >= dataUrl.length) return null;
    return out;
  } catch {
    return null;
  }
}

/**
 * 对整批书签/引擎做一次性瘦身
 *
 * @param readRoot 读取当前 root
 * @param commit   提交变更（传入新的 bookmarks/engines）
 * @returns 被成功缩减的条目数
 */
export async function runIconShrinkOnce(
  readRoot: () => Promise<{ bookmarks?: unknown; engines?: unknown } | undefined>,
  commit: (next: { bookmarks: IconItem[]; engines: IconItem[] }) => Promise<void>,
): Promise<number> {
  // 读取失败必须自行吞掉：这是后台维护任务，绝不能把异常抛给启动流程
  let root: { bookmarks?: unknown; engines?: unknown } | undefined;
  try {
    root = await readRoot();
  } catch (e) {
    LOGW('ICON', '读取数据失败，跳过图标瘦身', e);
    return 0;
  }
  if (!root) return 0;

  const bookmarks = Array.isArray(root.bookmarks) ? (root.bookmarks as IconItem[]) : [];
  const engines = Array.isArray(root.engines) ? (root.engines as IconItem[]) : [];

  const pending: Array<{ list: 'b' | 'e'; idx: number; dataUrl: string }> = [];
  bookmarks.forEach((b, idx) => { if (needsShrink(b?.icon)) pending.push({ list: 'b', idx, dataUrl: b.icon }); });
  engines.forEach((e, idx) => { if (needsShrink(e?.icon)) pending.push({ list: 'e', idx, dataUrl: e.icon }); });

  if (!pending.length) return 0;

  const batch = pending.slice(0, MAX_PER_SESSION);
  LOGI('ICON', `发现 ${pending.length} 个超大图标，本批处理 ${batch.length} 个`);

  const nextBookmarks = bookmarks.map((b) => ({ ...b }));
  const nextEngines = engines.map((e) => ({ ...e }));
  let changed = 0;
  let done = 0;

  for (const task of batch) {
    const list = task.list === 'b' ? nextBookmarks : nextEngines;
    const target = list[task.idx];
    if (!target) continue;
    try {
      const out = await shrinkFaviconDataUrl(task.dataUrl);
      if (out) {
        target.icon = out;
        changed++;
      }
    } catch { /* 单个失败不影响其余 */ }
    done++;
    if (done % YIELD_EVERY === 0) await yieldToUI();
  }

  if (changed > 0) {
    try {
      await commit({ bookmarks: nextBookmarks, engines: nextEngines });
      LOGI('ICON', `图标瘦身完成，缩减 ${changed} 个`);
    } catch (e) {
      LOGW('ICON', '图标瘦身提交失败，保持原数据', e);
      return 0;
    }
  }
  return changed;
}

export { SHRINK_THRESHOLD_BASE64, MAX_PER_SESSION, needsShrink };
