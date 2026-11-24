/**
 * 数据模型的唯一真相来源：默认值、字段清洗、URL 规范化。
 *
 * newtab 页 / background SW / 备份导入 / 数据迁移全部复用这里的函数，
 * 保证「什么是合法数据」只有一个定义。
 *
 * 清洗原则：
 * - 逐条过滤，绝不因为一条坏数据丢弃整个数组（旧版 isBookmarkArray 用 every
 *   整体校验，一条坏书签会让全部书签被当成空数组并写回）。
 * - 只保留已知字段，未知字段丢弃（防止旧版本遗留字段无限累积）。
 * - 返回新对象，不修改入参。
 *
 * @typedef {import('../src/core/types/model').Settings} Settings
 * @typedef {import('../src/core/types/model').Widgets} Widgets
 * @typedef {import('../src/core/types/model').WeatherCity} WeatherCity
 * @typedef {import('../src/core/types/model').FabState} FabState
 * @typedef {import('../src/core/types/model').FabPlacement} FabPlacement
 * @typedef {import('../src/core/types/model').Bookmark} Bookmark
 * @typedef {import('../src/core/types/model').Group} Group
 * @typedef {import('../src/core/types/model').SearchEngine} SearchEngine
 * @typedef {import('../src/core/types/model').NotebookEntry} NotebookEntry
 * @typedef {import('../src/core/types/model').NotebookImage} NotebookImage
 * @typedef {import('../src/core/types/model').SharedItem} SharedItem
 * @typedef {import('../src/core/types/model').StoreData} StoreData
 */
import { uid } from './uid.js';

/** 存储结构版本：2 = 按集合拆分的多 key 结构 */
export const SCHEMA_VERSION = 2;

export const DEFAULT_GROUP_ID = 'default';
const DEFAULT_GROUP_NAME = '未分组';

/** 图标像素范围（设置项「图标大小」） */
export const ICON_PX = Object.freeze({ min: 16, max: 60, def: 34 });
/** 记事本字号范围 */
export const NOTE_FONT_SIZE = Object.freeze({ min: 12, max: 28, def: 14 });
/** 记事本字体键（具体字体栈由 UI 层决定） */
const NOTE_FONT_KEYS = Object.freeze(['system', 'hei', 'song', 'kai', 'mono']);

/** 单个图标 dataURL 的长度上限（字符数，约 1.5MB 原始数据） */
const ICON_MAX_LEN = 2 * 1024 * 1024;

const BUILTIN_ENGINES = Object.freeze([
  { id: 'baidu', name: '百度', template: 'https://www.baidu.com/s?wd=%s', builtin: true },
  { id: 'google', name: 'Google', template: 'https://www.google.com/search?q=%s', builtin: true },
  { id: 'duck', name: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=%s', builtin: true },
  { id: 'yandex', name: 'Yandex', template: 'https://yandex.com/search/?text=%s', builtin: true },
]);

// ============ 基础工具 ============

/** @param {unknown} v @returns {v is Record<string, any>} */
export const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** @param {unknown} v @param {string} [d] */
const str = (v, d = '') => (typeof v === 'string' ? v : d);

/**
 * 数值清洗：非有限数返回默认值，否则夹到 [min, max]
 * @param {unknown} v @param {number} min @param {number} max @param {number|undefined} d
 */
function num(v, min, max, d) {
  if (v === null || v === undefined || v === '') return d;
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, n));
}

/** @param {unknown} v */
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * URL 规范化（全项目唯一的判重依据）
 * 只接受 http(s)；返回 WHATWG URL 的 href（主机名小写、补根路径斜杠等）。
 * 旧版各处判重规则不一：background 用原样字符串比较，悬浮按钮用 new URL().href，
 * 导致「星标亮着却取消不了收藏」。
 * @param {unknown} u
 * @returns {string} 规范化后的 URL；非法时返回 ''
 */
export function normalizeUrl(u) {
  if (typeof u !== 'string') return '';
  const t = u.trim();
  if (!/^https?:\/\//i.test(t)) return '';
  try {
    return new URL(t).href;
  } catch {
    return '';
  }
}

/**
 * 图标值清洗：接受 data:image/* 或 http(s) 地址
 * @param {unknown} v
 * @returns {string|undefined}
 */
export function sanitizeIcon(v) {
  if (typeof v !== 'string' || !v) return undefined;
  if (v.length > ICON_MAX_LEN) return undefined;
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(v)) return v;
  if (normalizeUrl(v)) return v;
  return undefined;
}

/** @param {unknown} v */
function sanitizeColor(v) {
  return typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : undefined;
}

/** @param {unknown} v @returns {{left:number, top:number}|undefined} */
function sanitizePos(v) {
  if (!isObj(v) || !finite(v.left) || !finite(v.top)) return undefined;
  return { left: Math.round(v.left), top: Math.round(v.top) };
}

// ============ 设置 ============

/** @returns {Settings} */
export function defaultSettings() {
  return {
    openMode: 'newtab',
    iconPx: ICON_PX.def,
    showName: true,
    radius: 12,
    cardPadding: 12,
    defaultSearchId: 'baidu',
    dockIds: [],
    notebookFontSize: NOTE_FONT_SIZE.def,
    notebookFontFamily: 'system',
    groupNameMode: 'always',
    colorScheme: 'dark',
    widgets: defaultWidgets(),
  };
}

/** @returns {Widgets} */
function defaultWidgets() {
  return { clock: true, clock24: true, date: true, lunar: true, weather: false, city: null };
}

/** @param {unknown} v @param {number} max */
const shortText = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/**
 * @param {unknown} raw
 * @returns {WeatherCity | null}
 */
export function sanitizeCity(raw) {
  if (!isObj(raw)) return null;
  const name = shortText(raw.name, 60);
  if (!name || !finite(raw.lat) || !finite(raw.lon)) return null;
  if (Math.abs(raw.lat) > 90 || Math.abs(raw.lon) > 180) return null;
  /** @type {WeatherCity} */
  const out = { name, lat: raw.lat, lon: raw.lon };
  const admin = shortText(raw.admin, 60);
  const country = shortText(raw.country, 60);
  if (admin) out.admin = admin;
  if (country) out.country = country;
  return out;
}

/**
 * @param {unknown} raw
 * @returns {Widgets}
 */
function sanitizeWidgets(raw) {
  const w = isObj(raw) ? raw : {};
  const d = defaultWidgets();
  /** @param {'clock' | 'clock24' | 'date' | 'lunar' | 'weather'} k */
  const bool = (k) => (typeof w[k] === 'boolean' ? w[k] : d[k]);
  return {
    clock: bool('clock'),
    clock24: bool('clock24'),
    date: bool('date'),
    lunar: bool('lunar'),
    weather: bool('weather'),
    city: sanitizeCity(w.city),
  };
}

const ICON_SIZE_LEGACY = /** @type {const} */ ({ sm: 36, md: 48, lg: 60 });
const BG_POSITIONS = ['center', 'top', 'bottom', 'left', 'right'];
const BG_SIZES = ['cover', 'contain', 'auto', 'tile'];

/**
 * @param {unknown} raw
 * @returns {Settings}
 */
export function sanitizeSettings(raw) {
  const s = isObj(raw) ? raw : {};
  const d = defaultSettings();
  /** @type {Settings} */
  const out = {
    openMode: s.openMode === 'current' ? 'current' : 'newtab',
    iconPx: Math.round(
      /** @type {number} */ (
        num(
          s.iconPx ?? ICON_SIZE_LEGACY[/** @type {'sm'|'md'|'lg'} */ (s.iconSize)],
          ICON_PX.min,
          ICON_PX.max,
          d.iconPx
        )
      )
    ),
    showName: typeof s.showName === 'boolean' ? s.showName : d.showName,
    radius: Math.round(/** @type {number} */ (num(s.radius, 0, 28, d.radius))),
    cardPadding: Math.round(/** @type {number} */ (num(s.cardPadding, 2, 30, d.cardPadding))),
    defaultSearchId: str(s.defaultSearchId, d.defaultSearchId) || d.defaultSearchId,
    dockIds: Array.isArray(s.dockIds)
      ? Array.from(new Set(s.dockIds.filter((x) => typeof x === 'string' && x)))
      : [],
    notebookFontSize: Math.round(
      /** @type {number} */ (num(s.notebookFontSize, NOTE_FONT_SIZE.min, NOTE_FONT_SIZE.max, NOTE_FONT_SIZE.def))
    ),
    notebookFontFamily: NOTE_FONT_KEYS.includes(s.notebookFontFamily)
      ? s.notebookFontFamily
      : 'system',
    groupNameMode: s.groupNameMode === 'hover' ? 'hover' : 'always',
    // 键名不用 theme：旧版残留的 theme 字段从未生效，沿用会让部分用户升级后突然变成浅色
    colorScheme: s.colorScheme === 'light' || s.colorScheme === 'system' ? s.colorScheme : 'dark',
    widgets: sanitizeWidgets(s.widgets),
  };
  const opacity = num(s.cardOpacity, 0.2, 1, undefined);
  if (opacity !== undefined) out.cardOpacity = opacity;
  const overlay = num(s.backgroundOverlay, 0, 0.6, undefined);
  if (overlay !== undefined) out.backgroundOverlay = overlay;
  const blur = num(s.backgroundBlur, 0, 20, undefined);
  if (blur !== undefined) out.backgroundBlur = blur;
  if (BG_POSITIONS.includes(s.backgroundPosition)) out.backgroundPosition = s.backgroundPosition;
  if (BG_SIZES.includes(s.backgroundSize)) out.backgroundSize = s.backgroundSize;
  const sp = sanitizePos(s.settingsPanelPos);
  if (sp) out.settingsPanelPos = sp;
  const ip = sanitizePos(s.sharedItemsPanelPos);
  if (ip) out.sharedItemsPanelPos = ip;
  const sz = s.notebookPanelSize;
  if (
    isObj(sz) &&
    finite(sz.w) &&
    finite(sz.h) &&
    sz.w >= 320 &&
    sz.w <= 1600 &&
    sz.h >= 240 &&
    sz.h <= 1200
  ) {
    out.notebookPanelSize = { w: Math.round(sz.w), h: Math.round(sz.h) };
  }
  if (typeof s.notebookCurrentId === 'string' && s.notebookCurrentId) {
    out.notebookCurrentId = s.notebookCurrentId;
  }
  return out;
}

/**
 * 对设置应用补丁：值为 undefined 的键表示「删除该键（恢复默认）」
 * @param {Settings} cur
 * @param {Record<string, unknown>} patch
 * @returns {Settings}
 */
export function applySettingsPatch(cur, patch) {
  /** @type {Record<string, unknown>} */
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return sanitizeSettings(next);
}

// ============ 悬浮按钮 ============

/** @returns {FabPlacement} */
const defaultFabPlacement = () => ({ side: 'right', x: 12, y: 0.5 });

/**
 * @param {unknown} raw
 * @returns {FabState}
 */
export function sanitizeFab(raw) {
  const f = isObj(raw) ? raw : {};
  const p = isObj(f.placement) ? f.placement : {};
  const d = defaultFabPlacement();
  return {
    enabled: f.enabled !== false,
    placement: {
      side: p.side === 'left' ? 'left' : 'right',
      x: Math.round(/** @type {number} */ (num(p.x, 0, 10000, d.x))),
      y: /** @type {number} */ (num(p.y, 0, 1, d.y)),
    },
  };
}

// ============ 分组与书签 ============

/** @returns {Group} */
export const defaultGroup = () => ({ id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, order: 10 });

/**
 * @param {unknown} raw
 * @param {{ fallback?: boolean }} [opts] fallback=true 时空列表补一个默认分组
 * @returns {Group[]}
 */
export function sanitizeGroups(raw, opts = {}) {
  const { fallback = true } = opts;
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  /** @type {Group[]} */
  const out = [];
  list.forEach((g, i) => {
    if (!isObj(g) || typeof g.id !== 'string' || !g.id || seen.has(g.id)) return;
    seen.add(g.id);
    /** @type {Group} */
    const item = {
      id: g.id,
      name: str(g.name).trim() || '未命名分组',
      order: finite(g.order) ? g.order : (i + 1) * 10,
    };
    if (typeof g.icon === 'string' && g.icon) item.icon = g.icon;
    out.push(item);
  });
  if (!out.length && fallback) out.push(defaultGroup());
  return out;
}

/** @param {Group[]} groups */
export function sortGroups(groups) {
  return groups.slice().sort((a, b) => a.order - b.order);
}

/** @param {Group[]} groups @returns {string} */
export function firstGroupId(groups) {
  return sortGroups(groups)[0]?.id || DEFAULT_GROUP_ID;
}

/**
 * 解析目标分组：存在则用之，否则回落到排序第一的分组
 * （旧版写死 'default'，而导入流程会删除空的 default 分组，书签因此不可见）
 * @param {Group[]} groups @param {unknown} groupId
 */
export function resolveGroupId(groups, groupId) {
  if (typeof groupId === 'string' && groups.some((g) => g.id === groupId)) return groupId;
  return firstGroupId(groups);
}

/**
 * @param {unknown} raw
 * @param {Group[]} groups 已清洗的分组；孤儿书签归入第一个分组
 * @returns {Bookmark[]}
 */
export function sanitizeBookmarks(raw, groups) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  /** @type {Bookmark[]} */
  const out = [];
  list.forEach((b, i) => {
    if (!isObj(b) || typeof b.id !== 'string' || !b.id || seen.has(b.id)) return;
    const url = typeof b.url === 'string' ? b.url.trim() : '';
    if (!normalizeUrl(url)) return;
    seen.add(b.id);
    /** @type {Bookmark} */
    const item = {
      id: b.id,
      title: str(b.title).trim() || url,
      url,
      groupId: resolveGroupId(groups, b.groupId ?? DEFAULT_GROUP_ID),
      order: finite(b.order) ? b.order : (i + 1) * 10,
      createdAt: finite(b.createdAt) ? b.createdAt : 0,
      updatedAt: finite(b.updatedAt) ? b.updatedAt : 0,
    };
    const icon = sanitizeIcon(b.icon);
    if (icon) item.icon = icon;
    const color = sanitizeColor(b.color);
    if (color) item.color = color;
    out.push(item);
  });
  return out;
}

/**
 * 组内下一个排序值
 * @param {Bookmark[]} list @param {string} groupId
 */
export function nextOrder(list, groupId) {
  const max = list.reduce((m, b) => (b.groupId === groupId ? Math.max(m, b.order) : m), 0);
  return Math.floor(max / 10) * 10 + 10;
}

/**
 * 新建书签（调用方负责判重与分组解析）
 * @param {{url:string, title?:string, icon?:string, color?:string, groupId:string}} data
 * @param {Bookmark[]} existing
 * @returns {Bookmark}
 */
export function createBookmark(data, existing) {
  const now = Date.now();
  const url = normalizeUrl(data.url);
  /** @type {Bookmark} */
  const b = {
    id: uid('bm-'),
    title: str(data.title).trim() || url,
    url,
    groupId: data.groupId,
    order: nextOrder(existing, data.groupId),
    createdAt: now,
    updatedAt: now,
  };
  const icon = sanitizeIcon(data.icon);
  if (icon) b.icon = icon;
  const color = sanitizeColor(data.color);
  if (color) b.color = color;
  return b;
}

/**
 * 按规范化 URL 查找书签
 * @param {Bookmark[]} list @param {string} url
 */
export function findByUrl(list, url) {
  const key = normalizeUrl(url);
  if (!key) return undefined;
  return list.find((b) => normalizeUrl(b.url) === key);
}

// ============ 搜索引擎 ============

/** @returns {SearchEngine[]} */
export const builtinEngines = () => BUILTIN_ENGINES.map((e) => ({ ...e }));

/**
 * @param {unknown} raw
 * @param {{ fallback?: boolean }} [opts]
 * @returns {SearchEngine[]}
 */
export function sanitizeEngines(raw, opts = {}) {
  const { fallback = true } = opts;
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  /** @type {SearchEngine[]} */
  const out = [];
  for (const e of list) {
    if (!isObj(e) || typeof e.id !== 'string' || !e.id || seen.has(e.id)) continue;
    const template = str(e.template).trim();
    if (!template.includes('%s') || !normalizeUrl(template.replace('%s', 'q'))) continue;
    seen.add(e.id);
    /** @type {SearchEngine} */
    const item = { id: e.id, name: str(e.name).trim() || e.id, template };
    if (e.builtin === true) item.builtin = true;
    const icon = sanitizeIcon(e.icon);
    if (icon) item.icon = icon;
    if (finite(e.iconCheckedAt)) item.iconCheckedAt = e.iconCheckedAt;
    out.push(item);
  }
  if (!out.length && fallback) return builtinEngines();
  return out;
}

// ============ 记事本 ============

/** @param {unknown} raw @returns {NotebookImage[]} */
function sanitizeImages(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  /** @type {NotebookImage[]} */
  const out = [];
  for (const it of raw) {
    if (!isObj(it)) continue;
    const id = typeof it.id === 'string' && it.id ? it.id : uid('img-');
    if (seen.has(id)) continue;
    seen.add(id);
    /** @type {NotebookImage} */
    const img = {
      id,
      size: finite(it.size) ? it.size : 0,
      createdAt: finite(it.createdAt) ? it.createdAt : Date.now(),
    };
    if (typeof it.name === 'string') img.name = it.name;
    if (typeof it.mime === 'string') img.mime = it.mime;
    // dataUrl 仅存在于旧数据与备份文件中，会被迁移到 IndexedDB
    if (typeof it.dataUrl === 'string' && it.dataUrl.startsWith('data:image/')) img.dataUrl = it.dataUrl;
    out.push(img);
  }
  return out;
}

/**
 * @param {{ id?: string, name?: string }} [init]
 * @returns {NotebookEntry}
 */
export function createNotebookEntry(init = {}) {
  return {
    id: init.id || uid('nb-'),
    name: init.name || '默认笔记',
    content: '',
    updatedAt: 0,
    images: [],
  };
}

/**
 * @param {unknown} raw
 * @param {{ fallback?: boolean, legacy?: unknown }} [opts]
 *   legacy: 旧版单条 notebook 对象；列表为空时迁移为一条「默认笔记」
 * @returns {NotebookEntry[]}
 */
export function sanitizeNotebooks(raw, opts = {}) {
  const { fallback = true, legacy } = opts;
  let list = Array.isArray(raw) ? raw : [];
  if (!list.length && isObj(legacy) && (typeof legacy.content === 'string' || Array.isArray(legacy.images))) {
    list = [{ ...legacy, id: 'default', name: '默认笔记' }];
  }
  const seen = new Set();
  /** @type {NotebookEntry[]} */
  const out = [];
  for (const x of list) {
    if (!isObj(x)) continue;
    const id = typeof x.id === 'string' && x.id ? x.id : uid('nb-');
    if (seen.has(id)) continue;
    seen.add(id);
    /** @type {NotebookEntry} */
    const e = {
      id,
      name: str(x.name).trim() || '未命名笔记',
      content: str(x.content),
      updatedAt: finite(x.updatedAt) ? x.updatedAt : 0,
      images: sanitizeImages(x.images),
    };
    const pos = sanitizePos(x.panelPos);
    if (pos) e.panelPos = pos;
    out.push(e);
  }
  if (!out.length && fallback) out.push(createNotebookEntry({ id: 'default' }));
  return out;
}

// ============ 收纳箱 ============

/**
 * 收纳条目主键：严格单调递增，与 Date.now() 同量级。
 * 直接用 Date.now() 时，同一毫秒内新增两条会主键碰撞，
 * 导致删除一条时两条一起被删。
 */
let lastItemId = 0;
export function nextItemId() {
  const now = Date.now();
  lastItemId = now > lastItemId ? now : lastItemId + 1;
  return lastItemId;
}

/**
 * 归一化单条收纳条目（兼容手机 Nav 分享数据与备份文件）
 * @param {unknown} raw
 * @returns {SharedItem}
 */
export function normalizeSharedItem(raw) {
  const x = isObj(raw) ? raw : {};
  let url = str(x.url);
  let title = str(x.title);
  // Nav 偶发把 url 与 title 写反：url 不是链接而 title 是，则交换
  if (url && !/^https?:\/\//i.test(url) && /^https?:\/\//i.test(title)) {
    [url, title] = [title, url];
  }
  return {
    id: typeof x.id === 'number' && Number.isFinite(x.id) ? x.id : nextItemId(),
    url,
    title,
    description: str(x.description),
    thumbnail: str(x.thumbnail),
    source: str(x.source),
    contentType: str(x.contentType, 'url') || 'url',
    createdAt: finite(x.createdAt) ? x.createdAt : Date.now(),
  };
}

/**
 * @param {unknown} raw
 * @returns {SharedItem[]}
 */
export function sanitizeSharedItems(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  /** @type {SharedItem[]} */
  const out = [];
  for (const it of raw) {
    if (!isObj(it)) continue;
    const item = normalizeSharedItem(it);
    if (seen.has(item.id)) item.id = nextItemId();
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

// ============ 背景图 ============

/** @param {unknown} v @returns {string} */
export function sanitizeBackground(v) {
  return typeof v === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(v) ? v : '';
}

// ============ 整体 ============

/** @returns {StoreData} */
export function defaultData() {
  const groups = [defaultGroup()];
  return {
    settings: defaultSettings(),
    background: '',
    fab: sanitizeFab(undefined),
    groups,
    bookmarks: [],
    engines: builtinEngines(),
    notebooks: [createNotebookEntry({ id: 'default' })],
    sharedItems: [],
  };
}

/**
 * 各字段的清洗函数。bookmarks 依赖 groups，因此需要传入上下文。
 * @type {{ [K in keyof StoreData]: (v: unknown, ctx: { groups: Group[] }) => StoreData[K] }}
 */
export const SANITIZERS = {
  settings: (v) => sanitizeSettings(v),
  background: (v) => sanitizeBackground(v),
  fab: (v) => sanitizeFab(v),
  groups: (v) => sanitizeGroups(v),
  bookmarks: (v, ctx) => sanitizeBookmarks(v, ctx.groups),
  engines: (v) => sanitizeEngines(v),
  notebooks: (v) => sanitizeNotebooks(v),
  sharedItems: (v) => sanitizeSharedItems(v),
};

/**
 * 从 v1 单 key 结构（localGce）构建 v2 数据
 * @param {unknown} legacy 旧版 localGce 对象
 * @param {unknown} [dockMirror] 旧版 gceDockIdsBackup 镜像
 * @returns {StoreData}
 */
export function buildFromLegacy(legacy, dockMirror) {
  if (!isObj(legacy)) return defaultData();
  const ls = isObj(legacy.settings) ? legacy.settings : {};
  const groups = sanitizeGroups(legacy.groups);
  const bookmarks = sanitizeBookmarks(legacy.bookmarks, groups);
  const settings = sanitizeSettings({
    ...ls,
    notebookCurrentId: legacy.__notebookCurrentId,
  });
  // 旧版在 dockIds 为空时会用镜像键恢复，这里迁移时做一次同样的恢复
  if (!settings.dockIds.length && Array.isArray(dockMirror)) {
    settings.dockIds = dockMirror.filter((x) => typeof x === 'string');
  }
  const valid = new Set(bookmarks.map((b) => b.id));
  settings.dockIds = Array.from(new Set(settings.dockIds)).filter((id) => valid.has(id));
  return {
    settings,
    background: sanitizeBackground(ls.backgroundDataUrl),
    // 旧版 fabEnabled 缺失时视为开启（初始数据为 true）
    fab: sanitizeFab({ enabled: ls.fabEnabled !== false }),
    groups,
    bookmarks,
    engines: sanitizeEngines(legacy.engines ?? legacy.searchEngines),
    notebooks: sanitizeNotebooks(legacy.notebooks, { legacy: legacy.notebook }),
    sharedItems: sanitizeSharedItems(legacy.sharedItems),
  };
}
