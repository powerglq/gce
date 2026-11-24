/**
 * 备份导入 / 导出 / 清空数据
 *
 * 备份文件格式是「不可变契约」（见 tests/backup.format.test.js）：
 *   { type: 'local-gce-backup', version: '1.0.0', exportedAt, payload }
 *   payload = { settings, engines, bookmarks, groups, notebooks, sharedItems }
 *   - settings 中内联 backgroundDataUrl 与 fabEnabled（存储中它们是独立 key）
 *   - 笔记图片以 dataUrl 内联（存储中本体在 IndexedDB）
 * 同时兼容旧版 local-wetab-backup 信封与 GCE/Wetab 的 store-icon 格式。
 *
 * 导入是一次原子写入：全部字段在同一个写锁内基于最新数据合并后写回。
 */
import { read, update } from '../store/useStorage';
import {
  DEFAULT_GROUP_ID,
  applySettingsPatch,
  builtinEngines,
  defaultGroup,
  defaultSettings,
  isObj,
  normalizeUrl,
  sanitizeBackground,
  sanitizeEngines,
  sanitizeGroups,
  sanitizeNotebooks,
  sanitizeSharedItems,
} from '../../../shared/model.js';
import { getNotebookImageBlob, putNotebookImage } from './imageAttachmentRepo';
import { blobToDataURL, dataURLToBlob } from './image';
import { clearSiteCache } from './siteCache';
import type { Bookmark, Group, NotebookEntry, Settings, StoreData } from '../types/model';

const BACKUP_TYPE = 'local-gce-backup';
const LEGACY_WETAB_TYPE = 'local-wetab-backup';
const VERSION = '1.0.0';

export type BackupCategory = 'settings' | 'engines' | 'bookmarks' | 'notebooks' | 'sharedItems';

export interface BackupPreview {
  groups: number;
  bookmarks: number;
  notebooks: number;
  sharedItems: number;
  hasSettings: boolean;
  hasEngines: boolean;
}

/** 备份文件是外部输入：字段类型未知，所有值都经过 shared/model.js 的清洗函数后才使用 */
type Raw = Record<string, any>;

// ============ 导出 ============

export async function exportBackup(): Promise<Blob> {
  const data = (await read()) as StoreData;
  const notebooks = await Promise.all(
    data.notebooks.map(async (e) => ({
      ...e,
      images: await Promise.all(
        e.images.map(async (img) => {
          if (img.dataUrl) return img;
          try {
            const blob = await getNotebookImageBlob(img.id);
            if (!blob) return img;
            return { ...img, mime: blob.type, size: img.size || blob.size, dataUrl: await blobToDataURL(blob) };
          } catch {
            return img;
          }
        })
      ),
    }))
  );
  const payload = {
    settings: {
      ...data.settings,
      fabEnabled: data.fab.enabled,
      ...(data.background ? { backgroundDataUrl: data.background } : {}),
    },
    engines: data.engines,
    bookmarks: data.bookmarks,
    groups: data.groups,
    notebooks,
    sharedItems: data.sharedItems,
  };
  const text = JSON.stringify(
    { type: BACKUP_TYPE, version: VERSION, exportedAt: new Date().toISOString(), payload },
    null,
    2
  );
  return new Blob([text], { type: 'application/json' });
}

// ============ 解析 ============

function isGceLegacyBackup(obj: Raw): boolean {
  return !!(obj?.version && obj?.data?.['store-icon'] && Array.isArray(obj.data['store-icon'].icons));
}

/** GCE（原 Wetab）store-icon 格式 → payload */
function convertGceLegacy(legacy: Raw): Raw {
  const icons = legacy.data['store-icon'].icons as Raw[];
  const groups: Raw[] = [];
  const bookmarks: Raw[] = [];
  const now = Date.now();
  icons.forEach((g, gi) => {
    if (!isObj(g)) return;
    const gid = typeof g.id === 'string' && g.id ? g.id : `gp-${gi}`;
    groups.push({ id: gid, name: g.name || `分组${gi + 1}`, order: (gi + 1) * 10, icon: g.iconClass || undefined });
    (Array.isArray(g.children) ? g.children : []).forEach((c: Raw, bi: number) => {
      if (!isObj(c) || c.type !== 'site') return;
      bookmarks.push({
        id: c.id || `bm-${gi}-${bi}`,
        title: c.name || '未命名',
        url: c.target || '',
        icon: c.bgType === 'image' ? c.bgImage : undefined,
        color: c.bgType === 'color' ? c.bgColor : undefined,
        groupId: gid,
        order: (bi + 1) * 10,
        createdAt: c.updateTime || now,
        updatedAt: c.lasttime || c.updateTime || now,
      });
    });
  });
  return { bookmarks, groups };
}

function extractPayload(text: string): Raw {
  let parsed: Raw;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('备份文件格式无效，不是有效的 JSON 文件');
  }
  if (parsed?.type === BACKUP_TYPE || parsed?.type === LEGACY_WETAB_TYPE) {
    if (!isObj(parsed.payload)) throw new Error('备份文件缺少数据内容（payload）');
    return parsed.payload;
  }
  if (isGceLegacyBackup(parsed)) return convertGceLegacy(parsed);
  const p = parsed?.payload;
  if (isObj(p) && (p.settings || p.engines || p.bookmarks || p.groups || p.sharedItems || p.notebooks)) return p;
  throw new Error('不支持的备份文件类型');
}

const arrLen = (v: unknown) => (Array.isArray(v) ? v.length : 0);

/** 仅解析备份文件，返回预览信息（基于原始字段，不受默认值干扰） */
export async function parseBackup(text: string): Promise<BackupPreview> {
  const raw = extractPayload(text);
  return {
    groups: arrLen(raw.groups),
    bookmarks: arrLen(raw.bookmarks),
    notebooks: arrLen(raw.notebooks) || (isObj(raw.notebook) && raw.notebook.content ? 1 : 0),
    sharedItems: arrLen(raw.sharedItems),
    hasSettings: isObj(raw.settings) && Object.keys(raw.settings).length > 0,
    hasEngines: arrLen(raw.engines) > 0,
  };
}

// ============ 导入（按 id 合并，重复项以备份为准） ============

function mergeById<T extends { id: string | number }>(cur: T[], inc: T[]): T[] {
  const map = new Map<string | number, T>();
  for (const x of cur) map.set(x.id, x);
  for (const x of inc) map.set(x.id, { ...(map.get(x.id) ?? {}), ...x } as T);
  return Array.from(map.values());
}

/** 备份中的笔记图片写入 IndexedDB，返回去掉 dataUrl 的条目 */
async function storeNotebookImages(list: NotebookEntry[]): Promise<NotebookEntry[]> {
  const out: NotebookEntry[] = [];
  for (const e of list) {
    const images = [];
    for (const img of e.images) {
      if (!img.dataUrl) {
        images.push(img);
        continue;
      }
      try {
        const blob = dataURLToBlob(img.dataUrl);
        await putNotebookImage({ id: img.id, blob, name: img.name, size: img.size || blob.size, type: blob.type, createdAt: img.createdAt });
        const { dataUrl: _drop, ...rest } = img;
        images.push({ ...rest, mime: blob.type, size: rest.size || blob.size });
      } catch {
        /* 无法解析的图片丢弃 */
      }
    }
    out.push({ ...e, images });
  }
  return out;
}

export interface ImportOptions {
  /** 仅导入指定类别；不传则全部导入 */
  categories?: BackupCategory[];
}

export async function importBackup(text: string, opts: ImportOptions = {}): Promise<Partial<StoreData>> {
  const raw = extractPayload(text);
  const want = (c: BackupCategory) => !opts.categories || opts.categories.includes(c);

  // --- 设置：只取备份中真实存在的键，避免用默认值覆盖当前设置 ---
  let settingsPatch: Raw | null = null;
  let background: string | null = null;
  let fabEnabled: boolean | null = null;
  if (want('settings') && isObj(raw.settings)) {
    const s = raw.settings as Raw;
    settingsPatch = Object.fromEntries(
      Object.entries(s).filter(
        ([k, v]) => v !== undefined && v !== null && !['backgroundDataUrl', 'fabEnabled'].includes(k)
      )
    );
    if (typeof s.backgroundDataUrl === 'string') background = sanitizeBackground(s.backgroundDataUrl) || null;
    if (typeof s.fabEnabled === 'boolean') fabEnabled = s.fabEnabled;
  }

  const engines = want('engines') ? sanitizeEngines(raw.engines, { fallback: false }) : [];
  const incGroups = want('bookmarks') ? sanitizeGroups(raw.groups, { fallback: false }) : [];
  const incBookmarks: Raw[] = want('bookmarks') && Array.isArray(raw.bookmarks) ? raw.bookmarks : [];
  const notebooks = want('notebooks')
    ? await storeNotebookImages(sanitizeNotebooks(raw.notebooks, { fallback: false, legacy: raw.notebook }))
    : [];
  const sharedItems = want('sharedItems') ? sanitizeSharedItems(raw.sharedItems) : [];

  return update(
    ['settings', 'background', 'fab', 'groups', 'bookmarks', 'engines', 'notebooks', 'sharedItems'],
    (cur) => {
      const patch: Partial<StoreData> = {};

      if (settingsPatch && Object.keys(settingsPatch).length) {
        const p = { ...settingsPatch };
        // 备份中的 Dock 为空而当前非空：保留当前，避免意外清空
        if (!(Array.isArray(p.dockIds) && p.dockIds.length)) delete p.dockIds;
        patch.settings = applySettingsPatch(cur.settings, p) as Settings;
      }
      if (background) patch.background = background;
      if (fabEnabled !== null) patch.fab = { ...cur.fab, enabled: fabEnabled };

      if (incGroups.length || incBookmarks.length) {
        let groups = mergeById(cur.groups, incGroups) as Group[];
        // 导入的书签：同 id 覆盖；URL 与现有其它书签重复的跳过
        const byUrl = new Map(cur.bookmarks.map((b) => [normalizeUrl(b.url), b.id]));
        const accepted = incBookmarks.filter((b) => {
          const key = normalizeUrl(b?.url);
          if (!key || typeof b?.id !== 'string') return false;
          const owner = byUrl.get(key);
          return owner === undefined || owner === b.id;
        });
        const bookmarks = mergeById<Bookmark>(cur.bookmarks, accepted as Bookmark[]);
        // 导入了其它分组且「未分组」为空时移除它（Wetab 等来源的备份不使用默认分组）
        const hasOthers = groups.some((g) => g.id !== DEFAULT_GROUP_ID);
        const defaultUsed = bookmarks.some((b) => (b.groupId ?? DEFAULT_GROUP_ID) === DEFAULT_GROUP_ID);
        if (incGroups.length && hasOthers && !defaultUsed && !incGroups.some((g) => g.id === DEFAULT_GROUP_ID)) {
          groups = groups.filter((g) => g.id !== DEFAULT_GROUP_ID);
        }
        patch.groups = groups;
        patch.bookmarks = bookmarks;
      }
      if (engines.length) patch.engines = mergeById(cur.engines, engines);
      if (notebooks.length) patch.notebooks = mergeById(cur.notebooks, notebooks);
      if (sharedItems.length) patch.sharedItems = mergeById(cur.sharedItems, sharedItems);
      return patch;
    }
  );
}

// ============ 清空数据 ============

export interface ClearOptions {
  settings?: boolean;
  background?: boolean;
  engines?: boolean;
  bookmarks?: boolean;
  groups?: boolean;
  notebooks?: boolean;
  sharedItems?: boolean;
  siteCache?: boolean;
}

/**
 * 清空选中的数据（一次原子写入）
 * - 设置：恢复默认，保留 Dock 与当前笔记选择（它们属于数据而非偏好）
 * - 搜索引擎：恢复内置引擎（不允许为空）
 * - 分组：恢复为单个「未分组」，现有书签全部归入其中
 * - 书签：清空书签与 Dock
 * - 笔记：恢复为一条空白笔记
 */
export async function clearData(opts: ClearOptions): Promise<Partial<StoreData>> {
  const res = await update(
    ['settings', 'background', 'groups', 'bookmarks', 'engines', 'notebooks', 'sharedItems'],
    (cur) => {
      const patch: Partial<StoreData> = {};
      if (opts.settings) {
        patch.settings = {
          ...defaultSettings(),
          dockIds: cur.settings.dockIds,
          ...(cur.settings.notebookCurrentId ? { notebookCurrentId: cur.settings.notebookCurrentId } : {}),
        } as Settings;
      }
      if (opts.background) patch.background = '';
      if (opts.engines) patch.engines = builtinEngines();
      if (opts.groups) {
        patch.groups = [defaultGroup()];
        patch.bookmarks = cur.bookmarks.map((b) => ({ ...b, groupId: DEFAULT_GROUP_ID }));
      }
      if (opts.bookmarks) patch.bookmarks = [];
      if (opts.notebooks) patch.notebooks = sanitizeNotebooks([]);
      if (opts.sharedItems) patch.sharedItems = [];
      return patch;
    }
  );
  if (opts.siteCache) await clearSiteCache();
  return res;
}
