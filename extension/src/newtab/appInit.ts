import { read, decodeFields, pickChanges, update } from '../core/store/useStorage';
import { useSettings } from '../core/store/useSettings';
import { useBookmarks } from '../core/store/useBookmarks';
import { useNotebook } from '../core/store/useNotebook';
import { useEngines } from '../core/store/useEngines';
import { useSharedItems } from '../core/store/useSharedItems';
import { runIconShrinkOnce } from '../core/utils/iconShrink';
import { toast } from '../core/utils/feedback';
import type { StoreData, StoreField } from '../core/types/model';

/** 把存储数据分发到各 store（启动 / 跨上下文同步 / 导入与清空后） */
export function applyAll(data: Partial<StoreData>) {
  const settings = useSettings();
  const bm = useBookmarks();
  if (data.settings || data.background !== undefined || data.fab) {
    settings.apply({ settings: data.settings, background: data.background, fab: data.fab });
  }
  if (data.groups || data.bookmarks) bm.apply({ groups: data.groups, bookmarks: data.bookmarks });
  if (data.engines) useEngines().apply(data.engines);
  if (data.notebooks) useNotebook().apply(data.notebooks);
  if (data.sharedItems) useSharedItems().apply(data.sharedItems);
}

let listening = false;

/**
 * 跨上下文同步：其它标签页 / background SW（悬浮按钮收藏）写入后，
 * 只把变化的字段应用到对应 store。本页自己的写入也会回调到这里，结果与内存一致。
 *
 * 旧版的同步监听通过 ResourceManager.onExternal 注册，调用写成
 * addListener(event, listener)，而 chrome 事件只接受 addListener(callback)，
 * 回调从未注册成功，导致 newtab 页看不到其它上下文的改动。
 */
function listenChanges() {
  if (listening) return;
  listening = true;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const raw = pickChanges(changes);
    const fields = Object.keys(raw) as StoreField[];
    if (!fields.length) return;
    applyAll(decodeFields(raw, fields, { groups: useBookmarks().groups }));
  });
}

/**
 * 启动：一次读取全部数据并分发到各 store。
 * 读取失败直接抛出——调用方显示错误页，绝不用默认数据顶替（否则会把空数据写回）。
 */
export async function bootstrap(): Promise<StoreData> {
  listenChanges();
  const data = (await read()) as StoreData;
  applyAll(data);
  return data;
}

/**
 * 启动后的后台维护（不阻塞首屏）：
 * - 旧数据中内联的笔记图片迁移到 IndexedDB
 * - 搜索引擎缺失的图标补抓
 * - 历史遗留的超大 favicon 就地瘦身
 */
export function scheduleStartupMaintenance(): void {
  setTimeout(() => {
    void useNotebook().migrateLegacyImages();
    void useEngines().ensureIcons();
    void shrinkIcons();
  }, 1500);
}

async function shrinkIcons() {
  const origin = new Map<string, string | undefined>();
  const changed = await runIconShrinkOnce(
    async () => {
      const cur = await read(['bookmarks', 'engines']);
      for (const b of cur.bookmarks) origin.set(`b:${b.id}`, b.icon);
      for (const e of cur.engines) origin.set(`e:${e.id}`, e.icon);
      return cur;
    },
    async (next) => {
      const nb = new Map(next.bookmarks.map((b) => [b.id, b.icon]));
      const ne = new Map(next.engines.map((e) => [e.id, e.icon]));
      // 按 id 合并，只替换「期间未被改动过」的图标
      const pick = <T extends { id: string; icon?: string }>(list: T[], m: Map<string, string | undefined>, p: string) =>
        list.map((x) => {
          const icon = m.get(x.id);
          return icon && icon !== x.icon && origin.get(`${p}:${x.id}`) === x.icon ? { ...x, icon } : x;
        });
      const res = await update(['bookmarks', 'engines'], (cur) => ({
        bookmarks: pick(cur.bookmarks, nb, 'b'),
        engines: pick(cur.engines, ne, 'e'),
      }));
      applyAll(res);
    }
  );
  if (changed > 0) toast(`已优化 ${changed} 个超大图标`);
}
