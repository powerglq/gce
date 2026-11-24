/**
 * GCE 存储层（newtab 页与 background SW 共用的唯一实现）
 *
 * 结构（v2）：每个集合一个 chrome.storage.local key。
 *   旧版（v1）把全部数据塞进单个 key `localGce`：任何一次写入（包括记事本每次输入）
 *   都要整体序列化书签图标与背景图，并把新旧两份完整值广播给所有监听者。
 *   拆分后，写记事本只写 gce.notebooks，书签/背景图不受影响。
 *
 * 写入规则（所有写操作只能走 update）：
 *   1. 跨上下文写锁（navigator.locks 以扩展来源为作用域，newtab 页与 SW 共享）
 *   2. 锁内读取最新数据 → mutator 基于最新数据计算 → 只写回 mutator 返回的字段
 *   3. 写入前统一清洗，保证存储中的数据永远满足不变量
 *      （书签所属分组必然存在、Dock 只含存在的书签）
 *   旧版各 store 用内存快照整体覆盖存储，是多标签页互相回滚数据的根因。
 *
 * 读取失败一律 reject，绝不当成「没有数据」。
 *
 * @typedef {import('../src/core/types/model').StoreData} StoreData
 * @typedef {import('../src/core/types/model').StoreField} StoreField
 */
import {
  SCHEMA_VERSION,
  SANITIZERS,
  buildFromLegacy,
  defaultData,
  sanitizeGroups,
} from './model.js';

/** @type {Readonly<Record<StoreField, string>>} */
export const KEYS = Object.freeze({
  settings: 'gce.settings',
  background: 'gce.background',
  fab: 'gce.fab',
  groups: 'gce.groups',
  bookmarks: 'gce.bookmarks',
  engines: 'gce.engines',
  notebooks: 'gce.notebooks',
  sharedItems: 'gce.sharedItems',
});

export const META_KEY = 'gce.meta';
/** v1 遗留 key：迁移后保留不删，作为回滚备份 */
const LEGACY_KEY = 'localGce';
const LEGACY_WETAB_KEY = 'localWeTab';
const LEGACY_DOCK_MIRROR = 'gceDockIdsBackup';
/** v1 遗留的辅助 key：迁移后删除 */
const OBSOLETE_KEYS = [LEGACY_DOCK_MIRROR, '__gceLastWriteError', 'gceIconShrinkBackup', '__storage_test__'];

/** @type {StoreField[]} */
const ALL_FIELDS = /** @type {StoreField[]} */ (Object.keys(KEYS));

/** 跨上下文写锁名称 */
const WRITE_LOCK = 'gce-storage-write';

const WRITE_TIMEOUT_MS = 8000;

/**
 * 业务校验错误（例如「该链接已存在」）。
 * 与存储故障区分：UI 直接展示 message，不当作「保存失败」。
 */
export class UserError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}

// ============ chrome.storage 底层封装 ============

/** @param {string[]} keys @returns {Promise<Record<string, any>>} */
function rawGet(keys) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get(keys, (res) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message || 'storage_read_failed'));
        else resolve(res || {});
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** @param {Record<string, unknown>} items @returns {Promise<void>} */
function rawSet(items) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set(items, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message || 'storage_write_failed'));
        else resolve();
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** @param {string[]} keys @returns {Promise<void>} */
function rawRemove(keys) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.remove(keys, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message || 'storage_remove_failed'));
        else resolve();
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * 超时保护：只用于「避免调用方无限等待」，底层写入不会被取消
 * @template T @param {Promise<T>} p @param {string} what @returns {Promise<T>}
 */
function withTimeout(p, what) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timeout after ${WRITE_TIMEOUT_MS}ms`)), WRITE_TIMEOUT_MS);
  });
  return /** @type {Promise<T>} */ (Promise.race([p, guard])).finally(() => clearTimeout(timer));
}

// ============ 跨上下文写锁 ============

const hasWebLocks =
  typeof navigator !== 'undefined' && !!navigator.locks && typeof navigator.locks.request === 'function';

/** 无 Web Locks 时的本上下文串行队列（测试环境 / 极旧浏览器） */
let localQueue = Promise.resolve();

/**
 * @template T @param {() => Promise<T>} task @returns {Promise<T>}
 */
function withLock(task) {
  if (hasWebLocks) return navigator.locks.request(WRITE_LOCK, { mode: 'exclusive' }, task);
  const run = localQueue.then(task);
  localQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// ============ 迁移（v1 → v2） ============

/** @param {StoreData} data */
function toStorageItems(data) {
  /** @type {Record<string, unknown>} */
  const items = {};
  for (const f of ALL_FIELDS) items[KEYS[f]] = data[f];
  return items;
}

/** 锁内执行：幂等 */
async function migrateInLock() {
  const meta = (await rawGet([META_KEY]))[META_KEY];
  if (meta && typeof meta.schema === 'number' && meta.schema >= SCHEMA_VERSION) return;

  const old = await rawGet([LEGACY_KEY, LEGACY_WETAB_KEY, LEGACY_DOCK_MIRROR]);
  const legacy = old[LEGACY_KEY] ?? old[LEGACY_WETAB_KEY];
  const data = legacy ? buildFromLegacy(legacy, old[LEGACY_DOCK_MIRROR]) : defaultData();
  // 新数据与 meta 在同一次 set 中写入：chrome.storage 的单次 set 是原子的，
  // 因此不会出现「数据写了一半但 meta 未写」的中间状态
  await rawSet({
    ...toStorageItems(data),
    [META_KEY]: { schema: SCHEMA_VERSION, migratedFrom: legacy ? 1 : 0, at: Date.now() },
  });
  try {
    await rawRemove(OBSOLETE_KEYS);
  } catch {
    /* 清理遗留辅助 key 失败不影响使用 */
  }
}

/** @type {Promise<void>|null} */
let schemaReady = null;

/**
 * 确保存储已是 v2 结构（每个上下文只真正执行一次；失败后允许重试）
 * @returns {Promise<void>}
 */
export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = withLock(migrateInLock).catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

// ============ 解码与清洗 ============

/**
 * 补齐依赖字段：bookmarks 的清洗依赖 groups；
 * 改 bookmarks 时需要同步清理 settings.dockIds
 * @param {StoreField[]} fields @returns {StoreField[]}
 */
function withDeps(fields) {
  const set = new Set(fields);
  if (set.has('bookmarks')) {
    set.add('groups');
    set.add('settings');
  }
  return ALL_FIELDS.filter((f) => set.has(f));
}

/**
 * @param {Record<string, unknown>} raw 以「字段名」为键的原始值
 * @param {StoreField[]} fields
 * @param {{ groups?: import('../src/core/types/model').Group[] }} [ctx]
 * @returns {Partial<StoreData>}
 */
export function decodeFields(raw, fields, ctx = {}) {
  /** @type {Record<string, unknown>} */
  const out = {};
  const groups =
    'groups' in raw || fields.includes('groups') ? SANITIZERS.groups(raw.groups, { groups: [] }) : ctx.groups;
  const c = { groups: groups || sanitizeGroups(undefined) };
  for (const f of fields) {
    out[f] = f === 'groups' ? c.groups : SANITIZERS[f](raw[f], c);
  }
  return /** @type {Partial<StoreData>} */ (out);
}

/** @param {StoreField[]} fields */
async function readRaw(fields) {
  const res = await rawGet(fields.map((f) => KEYS[f]));
  /** @type {Record<string, unknown>} */
  const raw = {};
  for (const f of fields) raw[f] = res[KEYS[f]];
  return raw;
}

// ============ 对外 API ============

/**
 * 读取并清洗指定字段
 * @template {StoreField} F
 * @param {F[]} [fields] 缺省读取全部
 * @returns {Promise<Pick<StoreData, F>>}
 */
export async function read(fields) {
  await ensureSchema();
  const need = withDeps(fields && fields.length ? fields : ALL_FIELDS);
  return /** @type {any} */ (decodeFields(await readRaw(need), need));
}

/**
 * 原子读-改-写（所有写操作的唯一入口）
 *
 * @template {StoreField} F
 * @param {F[]} fields mutator 需要读取的字段；只能写回这些字段
 * @param {(cur: Pick<StoreData, F>) => Partial<Pick<StoreData, F>> | void | Promise<Partial<Pick<StoreData, F>> | void>} mutator
 *   基于锁内最新数据计算补丁；抛出 UserError 表示业务校验失败（不写入）
 * @returns {Promise<Pick<StoreData, F>>} 写入后的最新数据（含依赖字段）
 */
export async function update(fields, mutator) {
  if (typeof mutator !== 'function') throw new TypeError('update requires a mutator function');
  await ensureSchema();
  const need = withDeps(fields);
  return withLock(async () => {
    const cur = decodeFields(await readRaw(need), need);
    const patch = (await mutator(/** @type {any} */ (cur))) || {};
    /** @type {Record<string, unknown>} */
    const rawPatch = {};
    for (const [f, v] of Object.entries(patch)) {
      if (!need.includes(/** @type {StoreField} */ (f))) {
        throw new Error(`update: 字段 ${f} 未在 fields 中声明`);
      }
      rawPatch[f] = v;
    }
    const written = /** @type {StoreField[]} */ (Object.keys(rawPatch));
    if (!written.length) return /** @type {any} */ (cur);

    // 写入值统一清洗（groups 先于 bookmarks，保证书签分组引用有效）
    const next = /** @type {Record<string, any>} */ ({ ...cur });
    const clean = decodeFields(rawPatch, written, { groups: /** @type {any} */ (cur).groups });
    Object.assign(next, clean);
    if (written.includes('groups') && need.includes('bookmarks') && !written.includes('bookmarks')) {
      // 分组变化后重新校验书签的分组引用（删除分组时书签归入第一个分组）
      next.bookmarks = SANITIZERS.bookmarks(next.bookmarks, { groups: next.groups });
      written.push('bookmarks');
    }
    // Dock 不变量：只包含存在的书签
    if (need.includes('bookmarks') && (written.includes('bookmarks') || written.includes('settings'))) {
      const valid = new Set(next.bookmarks.map((/** @type {{id:string}} */ b) => b.id));
      const dock = next.settings.dockIds.filter((/** @type {string} */ id) => valid.has(id));
      if (dock.length !== next.settings.dockIds.length) {
        next.settings = { ...next.settings, dockIds: dock };
        if (!written.includes('settings')) written.push('settings');
      }
    }

    /** @type {Record<string, unknown>} */
    const items = {};
    for (const f of written) items[KEYS[f]] = next[f];
    await withTimeout(rawSet(items), `write[${written.join(',')}]`);
    return /** @type {any} */ (next);
  });
}

/**
 * 从 storage.onChanged 的 changes 中提取本项目关心的字段原始新值
 * @param {Record<string, { newValue?: unknown }>} changes
 * @returns {Partial<Record<StoreField, unknown>>}
 */
export function pickChanges(changes) {
  /** @type {Partial<Record<StoreField, unknown>>} */
  const out = {};
  for (const f of ALL_FIELDS) {
    if (changes && KEYS[f] in changes) out[f] = changes[KEYS[f]].newValue;
  }
  return out;
}
