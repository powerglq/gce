/**
 * GCE Background Service Worker
 *
 * 职责：
 * 1. 启动时完成存储结构迁移（v1 → v2），并把 chrome.storage.local 限制为仅扩展可信上下文可访问
 * 2. 作为 content script（网页悬浮按钮）的唯一数据入口：
 *    content script 不直接读写存储（已被 setAccessLevel 禁止），全部通过消息由 SW 代办
 * 3. 悬浮按钮收藏后在后台抓取站点图标并回填
 * 4. 按「悬浮按钮已开启 且 已授权访问网站」动态注册 / 注销网页脚本（manifest 不再静态声明）
 *
 * newtab 页通过 storage.onChanged 感知 SW 的写入，无需额外广播。
 */
import { read, update, ensureSchema, KEYS, UserError } from './shared/storage.js';
import { normalizeUrl, findByUrl, createBookmark, firstGroupId, sanitizeFab } from './shared/model.js';
import { fetchSiteInfo } from './shared/favicon.js';
import { LOGW, LOGE } from './shared/log.js';
import { hasAllSites } from './shared/sitePermission.js';

// ============ 启动 ============

async function init() {
  // 默认情况下 storage.local 对 content script 可见；网页中的 content script 不需要它，
  // 收紧为仅扩展页面 / SW 可访问，降低被恶意页面利用的面。
  try {
    await chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch (e) {
    LOGW('BG', 'setAccessLevel 失败', e);
  }
  try {
    await ensureSchema();
  } catch (e) {
    LOGE('BG', '存储迁移失败', e);
  }
  syncFabScript();
}

// ============ 悬浮按钮脚本注册 ============

const FAB_SCRIPT_ID = 'gce-fab';

/** 串行执行，避免并发时重复注册同一 id 报错 */
let fabSync = Promise.resolve();

function syncFabScript() {
  fabSync = fabSync.then(doSyncFabScript).catch((e) => LOGW('BG', '同步悬浮按钮脚本失败', e));
}

async function doSyncFabScript() {
  const [{ fab }, granted, registered] = await Promise.all([
    read(['fab']),
    hasAllSites(),
    chrome.scripting.getRegisteredContentScripts({ ids: [FAB_SCRIPT_ID] }),
  ]);
  const want = fab.enabled && granted;
  if (want && registered.length === 0) {
    await chrome.scripting.registerContentScripts([
      {
        id: FAB_SCRIPT_ID,
        matches: ['https://*/*', 'http://*/*'],
        js: ['content/vendor/qrcode.min.js', 'content/floatingButtons.js'],
        runAt: 'document_idle',
      },
    ]);
  } else if (!want && registered.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [FAB_SCRIPT_ID] });
  }
}

chrome.permissions.onAdded.addListener(syncFabScript);
chrome.permissions.onRemoved.addListener(syncFabScript);

// SW 每次被唤醒都会执行顶层代码；ensureSchema 在同一 SW 实例内只执行一次
void init();
chrome.runtime.onInstalled.addListener(() => void init());
chrome.runtime.onStartup.addListener(() => void init());

// ============ 书签 URL 索引（悬浮按钮每次打开网页都会查询，避免反复解码全部书签） ============

/** @type {Set<string> | null} */
let urlIndex = null;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (KEYS.bookmarks in changes) urlIndex = null;
  if (KEYS.fab in changes) syncFabScript();
});

async function getUrlIndex() {
  if (!urlIndex) {
    const { bookmarks } = await read(['bookmarks']);
    urlIndex = new Set(bookmarks.map((b) => normalizeUrl(b.url)));
  }
  return urlIndex;
}

// ============ 消息处理 ============

/** @typedef {(payload: any, sender: chrome.runtime.MessageSender) => Promise<object>} Handler */

/** @type {Record<string, Handler>} */
const HANDLERS = {
  /** 悬浮按钮初始化 / 页面重新可见时查询状态 */
  async GCE_FAB_STATE(payload) {
    const { fab } = await read(['fab']);
    const url = normalizeUrl(payload?.url);
    const bookmarked = url ? (await getUrlIndex()).has(url) : false;
    return { enabled: fab.enabled, placement: fab.placement, bookmarked };
  },

  /** 悬浮按钮：开关与位置 */
  async GCE_FAB_PATCH(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const next = await update(['fab'], ({ fab }) => ({
      fab: sanitizeFab({
        ...fab,
        ...(typeof p.enabled === 'boolean' ? { enabled: p.enabled } : {}),
        ...(p.placement && typeof p.placement === 'object' ? { placement: p.placement } : {}),
      }),
    }));
    return { enabled: next.fab.enabled, placement: next.fab.placement };
  },

  /** 悬浮按钮：收藏当前页面 */
  async GCE_ADD_BOOKMARK(payload) {
    const url = normalizeUrl(payload?.url);
    if (!url) throw new UserError('仅支持收藏 http(s) 页面');
    const title = typeof payload?.title === 'string' ? payload.title.slice(0, 300) : '';
    const icons = Array.isArray(payload?.icons)
      ? payload.icons.filter((/** @type {unknown} */ u) => typeof u === 'string').slice(0, 4)
      : [];

    /** @type {import('./src/core/types/model').Bookmark | undefined} */
    let target;
    let duplicated = false;
    await update(['bookmarks'], ({ bookmarks, groups }) => {
      const exist = findByUrl(bookmarks, url);
      if (exist) {
        duplicated = true;
        target = exist;
        return;
      }
      target = createBookmark({ url, title, groupId: firstGroupId(groups) }, bookmarks);
      return { bookmarks: [...bookmarks, target] };
    });
    if (target && !target.icon) void fillIcon(target.id, url, icons);
    return { duplicated, id: target?.id };
  },

  /** 悬浮按钮：取消收藏（Dock 中的引用由存储层统一清理） */
  async GCE_REMOVE_BOOKMARK(payload) {
    const url = normalizeUrl(payload?.url);
    if (!url) throw new UserError('无效链接');
    let removed = false;
    await update(['bookmarks'], ({ bookmarks }) => {
      const hit = findByUrl(bookmarks, url);
      if (!hit) return;
      removed = true;
      return { bookmarks: bookmarks.filter((b) => b.id !== hit.id) };
    });
    return { removed };
  },
};

/**
 * 后台抓取图标并回填（失败静默：书签仍以首字母占位显示，可在卡片菜单里「获取图标」重试）
 * @param {string} id @param {string} url @param {string[]} extraIcons
 */
async function fillIcon(id, url, extraIcons) {
  try {
    const { icon } = await fetchSiteInfo(url, { extraIcons, wantTitle: false });
    if (!icon) return;
    await update(['bookmarks'], ({ bookmarks }) => {
      const b = bookmarks.find((x) => x.id === id);
      if (!b || b.icon) return;
      return {
        bookmarks: bookmarks.map((x) => (x.id === id ? { ...x, icon, updatedAt: Date.now() } : x)),
      };
    });
  } catch (e) {
    LOGW('BG', '抓取图标失败', url, e);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = message && typeof message.type === 'string' ? HANDLERS[message.type] : undefined;
  if (!handler) return false;
  // 只接受本扩展自身（content script / 扩展页面）发出的消息
  if (!sender || sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, message: 'untrusted_sender' });
    return false;
  }
  handler(message.payload, sender).then(
    (res) => sendResponse({ ok: true, ...res }),
    (err) => {
      if (!(err instanceof UserError)) LOGE('BG', message.type, err);
      sendResponse({ ok: false, message: err instanceof UserError ? err.message : '操作失败，请重试' });
    }
  );
  return true;
});
