/**
 * 站点图标 / 标题抓取（newtab 页与 background SW 共用的唯一实现）
 *
 * 为什么不依赖 DOM：background service worker 没有 DOMParser / Image / document，
 * 因此 HTML 用正则解析 <link>/<title>，图片用 createImageBitmap + OffscreenCanvas 解码与降采样，
 * 两者在窗口与 worker 中都可用（Chrome / Edge）。
 *
 * 处理要点：
 * - 空图检测：很多站点对 /favicon.ico 返回 200 + 1×1 透明图，必须视为失败
 * - 体积控制：只缩小不放大，最长边 128px，输出 PNG，超过 32KB 拒收
 * - SVG：worker 中 createImageBitmap 不支持 SVG，小于 32KB 的 SVG 原样保存
 *   （<img> 加载 SVG 不执行脚本，安全）
 * - 网页标题：按 Content-Type / <meta charset> 解码，兼容 GBK 等非 UTF-8 页面
 *
 * 网站访问权限是可选权限（optional_host_permissions，开启悬浮按钮时才申请）：
 * - 有该网站的访问权限：直接请求网站，图标质量最好，还能拿到网页标题
 * - 没有：读取浏览器自己缓存的图标（favicon 权限的 _favicon 接口，不发网络请求）
 */

/** 规范化后的最长边像素（覆盖 60px 图标在 2x 屏下的 120 物理像素） */
const TARGET_SIZE = 128;
/** 小于该字节数视为占位图 / 空图（1×1 PNG 约 70~200B，1×1 GIF 约 35B） */
const MIN_BYTES = 512;
/** 输出上限 */
const MAX_OUTPUT_BYTES = 32 * 1024;
/** 下载保护上限 */
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;
/** 判定为空白图的像素边长上限 */
const BLANK_EDGE = 2;
/** 单次请求超时 */
const TIMEOUT_MS = 4000;
/** 已知图标扩展名：部分站点以 application/octet-stream 返回 .ico */
const ICON_EXT = /\.(ico|png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i;

/**
 * @param {string} url @param {RequestInit} [init] @param {number} [ms]
 * @returns {Promise<Response>}
 */
function fetchWithTimeout(url, init = {}, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { credentials: 'omit', ...init, signal: ctrl.signal }).finally(() =>
    clearTimeout(timer)
  );
}

/**
 * 判断是否为空白 / 占位图
 * @param {{ width: number, height: number }} img
 * @param {number} byteSize
 */
export function isBlankIcon(img, byteSize, minBytes = MIN_BYTES) {
  if (byteSize < minBytes) return true;
  const w = img.width || 0;
  const h = img.height || 0;
  return w <= BLANK_EDGE || h <= BLANK_EDGE;
}

/** @param {Blob} blob @returns {Promise<string>} */
export async function blobToDataUrl(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, /** @type {any} */ (buf.subarray(i, i + CHUNK)));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

/** @param {Blob} blob */
async function looksLikeSvg(blob) {
  if (/svg/i.test(blob.type)) return true;
  try {
    const head = await blob.slice(0, 256).text();
    return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head);
  } catch {
    return false;
  }
}

/**
 * 把图标 Blob 规范化为 dataURL：空图检测 → 必要时降采样 → PNG
 * @param {Blob} blob
 * @param {{ minBytes?: number }} [opts]
 *   minBytes：小于该字节数视为占位图。浏览器缓存的图标经过重新编码，16px 的真实图标也可能只有几百字节，
 *   调用方传 0 关闭体积判断（此时由 fetchBrowserFavicon 的默认图标比对来排除占位图）
 * @returns {Promise<string>} 失败 / 空白 / 超限返回 ''
 */
export async function normalizeFaviconBlob(blob, opts = {}) {
  const { minBytes = MIN_BYTES } = opts;
  if (!blob || blob.size <= 0 || blob.size > MAX_DOWNLOAD_BYTES) return '';

  if (await looksLikeSvg(blob)) {
    if (blob.size < 64 || blob.size > MAX_OUTPUT_BYTES) return '';
    return blobToDataUrl(new Blob([blob], { type: 'image/svg+xml' }));
  }

  /** @type {ImageBitmap} */
  let bmp;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    return '';
  }
  try {
    if (isBlankIcon(bmp, blob.size, minBytes)) return '';
    const scale = Math.min(1, TARGET_SIZE / Math.max(bmp.width, bmp.height));
    // 尺寸已达标且体积正常：原样保留（避免无谓的重新编码损失）
    if (scale >= 1 && blob.size <= MAX_OUTPUT_BYTES && /^image\//i.test(blob.type)) {
      return blobToDataUrl(blob);
    }
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(bmp, 0, 0, w, h);
    const out = await canvas.convertToBlob({ type: 'image/png' });
    if (!out || out.size > MAX_OUTPUT_BYTES) return '';
    return blobToDataUrl(out);
  } catch {
    return '';
  } finally {
    try {
      bmp.close();
    } catch {
      /* 忽略 */
    }
  }
}

/**
 * 抓取并规范化单个图标地址
 * @param {string} url
 * @returns {Promise<string>}
 */
async function tryFetchFavicon(url) {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return '';
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/') && !ICON_EXT.test(url) && !ct.includes('octet-stream')) return '';
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_DOWNLOAD_BYTES) return '';
    return await normalizeFaviconBlob(await res.blob());
  } catch {
    return '';
  }
}

/**
 * 约定式同源候选（不依赖 HTML 解析，成本最低）
 * @param {string} origin
 */
export function conventionalCandidates(origin) {
  return [
    `${origin}/favicon.ico`,
    `${origin}/apple-touch-icon.png`,
    `${origin}/favicon.png`,
    `${origin}/favicon.svg`,
  ];
}

/** @param {string} s */
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * 解析单个标签的属性
 * @param {string} tag
 * @returns {Record<string, string>}
 */
function parseAttrs(tag) {
  /** @type {Record<string, string>} */
  const attrs = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const body = tag.replace(/^<\s*[a-z0-9]+/i, '').replace(/\/?>$/, '');
  let m;
  while ((m = re.exec(body))) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/**
 * 从 HTML 中按优先级收集 <link> 图标地址（仅同源）
 * 优先级：shortcut icon / icon > apple-touch-icon > mask-icon > fluid-icon；同级保持文档顺序
 * @param {string} html
 * @param {string} origin
 * @returns {string[]}
 */
export function collectIconLinksFromHtml(html, origin) {
  if (typeof html !== 'string' || !html) return [];
  let base;
  try {
    base = new URL(origin);
  } catch {
    return [];
  }
  /** @type {{ href: string, rank: number, idx: number }[]} */
  const picks = [];
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  tags.forEach((tag, idx) => {
    const attrs = parseAttrs(tag);
    const rel = (attrs.rel || '').toLowerCase();
    const href = (attrs.href || '').trim();
    if (!rel || !href) return;
    let rank;
    if (/(^|\s)(shortcut|icon)(\s|$)/.test(rel)) rank = 0;
    else if (/(^|\s)apple-touch-icon(-[\w-]+)?(\s|$)/.test(rel)) rank = 10;
    else if (/(^|\s)mask-icon(\s|$)/.test(rel)) rank = 20;
    else if (/(^|\s)fluid-icon(\s|$)/.test(rel)) rank = 30;
    else return;
    let abs;
    try {
      abs = new URL(href, base);
    } catch {
      return;
    }
    // 只接受同源：避免向第三方泄露书签站点
    if (abs.origin !== base.origin) return;
    picks.push({ href: abs.toString(), rank, idx });
  });
  picks.sort((a, b) => a.rank - b.rank || a.idx - b.idx);
  return Array.from(new Set(picks.map((p) => p.href)));
}

/**
 * 从 HTML 提取 <title>
 * @param {string} html
 */
export function extractTitle(html) {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html || '');
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

/**
 * 解码 HTML 响应：优先 Content-Type 的 charset，其次 <meta charset>，默认 UTF-8
 * @param {Response} res
 * @returns {Promise<string>}
 */
async function readHtml(res) {
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf.byteLength > 512 * 1024 ? buf.slice(0, 512 * 1024) : buf);
  let charset = /charset=([\w-]+)/i.exec(res.headers.get('content-type') || '')?.[1] || '';
  if (!charset) {
    const head = new TextDecoder('ascii').decode(bytes.subarray(0, 4096));
    charset =
      /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head)?.[1] ||
      /<meta[^>]+content\s*=\s*["'][^"']*charset=([\w-]+)/i.exec(head)?.[1] ||
      'utf-8';
  }
  try {
    return new TextDecoder(charset.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * 抓取页面 HTML（失败返回 ''）
 * @param {string} url
 */
async function fetchPageHtml(url) {
  try {
    const res = await fetchWithTimeout(url, { headers: { Accept: 'text/html,*/*;q=0.8' } });
    if (!res.ok) return '';
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct && !ct.includes('html')) return '';
    return await readHtml(res);
  } catch {
    return '';
  }
}

/**
 * 直接请求网站获取标题与图标（需要该网站的访问权限）：一次 HTML 请求同时得到标题与图标候选
 *
 * @param {string} pageUrl 页面地址
 * @param {{ extraIcons?: string[], wantTitle?: boolean, deadlineMs?: number }} [opts]
 *   extraIcons：调用方已知的图标地址（如悬浮按钮从当前页面 <link> 读到的地址，
 *   这些地址浏览器已经加载过，再次请求不会泄露新信息，因此允许跨源），优先尝试
 *   deadlineMs：总耗时上限，超过后不再尝试新的候选（background SW 空闲 30 秒会被回收）
 * @returns {Promise<{ title: string, icon: string }>}
 */
async function fetchFromSite(pageUrl, opts = {}) {
  const { extraIcons = [], wantTitle = true, deadlineMs = 15000 } = opts;
  const deadline = Date.now() + deadlineMs;
  let target;
  try {
    target = new URL(pageUrl);
  } catch {
    return { title: '', icon: '' };
  }
  if (!/^https?:$/.test(target.protocol)) return { title: '', icon: '' };
  const origin = target.origin;

  // 标题与 <link> 都在页面 HTML 里：只请求一次
  const htmlPromise = fetchPageHtml(target.href);
  const tried = new Set();
  /** @param {string} u */
  const attempt = async (u) => {
    if (!u || tried.has(u) || Date.now() > deadline) return '';
    tried.add(u);
    return tryFetchFavicon(u);
  };

  let icon = '';
  for (const u of extraIcons) {
    if (!/^https?:\/\//i.test(u)) continue;
    icon = await attempt(u);
    if (icon) break;
  }
  const html = await htmlPromise;
  if (!icon && html) {
    for (const u of collectIconLinksFromHtml(html, origin)) {
      icon = await attempt(u);
      if (icon) break;
    }
  }
  if (!icon) {
    for (const u of conventionalCandidates(origin)) {
      icon = await attempt(u);
      if (icon) break;
    }
  }
  return { title: wantTitle ? extractTitle(html) : '', icon };
}

// ============ 浏览器缓存的图标（favicon 权限） ============

/**
 * 当前是否有访问该网站的权限
 * @param {string} pageUrl
 */
export async function hasSiteAccess(pageUrl) {
  try {
    const origin = new URL(pageUrl).origin;
    return !!(await chrome.permissions?.contains?.({ origins: [`${origin}/*`] }));
  } catch {
    return false;
  }
}

/** @param {string} pageUrl @param {number} size */
function faviconApiUrl(pageUrl, size) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', String(size));
  return u.toString();
}

/** @param {Blob} blob */
async function digest(blob) {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 浏览器没有缓存某网站图标时，_favicon 返回一张通用的默认图标。
 * 这里不对它的样子做任何假设：用一个不可能被访问过的地址（.invalid 是保留域名）取一次默认图标，
 * 之后结果与它完全相同即视为「没有图标」。
 * @type {Map<number, Promise<string>>}
 */
const defaultIconDigest = new Map();
/** @param {number} size */
function getDefaultIconDigest(size) {
  let p = defaultIconDigest.get(size);
  if (!p) {
    p = fetch(faviconApiUrl('https://gce-default-icon.invalid/', size))
      .then((r) => (r.ok ? r.blob().then(digest) : ''))
      .catch(() => '');
    defaultIconDigest.set(size, p);
  }
  return p;
}

/**
 * 读取浏览器缓存的网站图标（不发网络请求；需要 favicon 权限）
 * @param {string} pageUrl
 * @returns {Promise<string>} 规范化后的 dataURL；浏览器没有缓存该网站图标时返回 ''
 */
export async function fetchBrowserFavicon(pageUrl, size = 64) {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return '';
  try {
    const [res, def] = await Promise.all([fetch(faviconApiUrl(pageUrl, size)), getDefaultIconDigest(size)]);
    if (!res.ok) return '';
    const blob = await res.blob();
    if (def && (await digest(blob)) === def) return '';
    return await normalizeFaviconBlob(blob, { minBytes: 0 });
  } catch {
    return '';
  }
}

/**
 * 获取站点标题与图标（全项目唯一入口）
 * - 有该网站的访问权限：请求网站本身（图标 + 标题）；没拿到图标时再读浏览器缓存
 * - 没有：只读浏览器缓存的图标，不向网站发任何请求；标题为空
 *
 * @param {string} pageUrl
 * @param {{ extraIcons?: string[], wantTitle?: boolean, deadlineMs?: number }} [opts] 见 fetchFromSite
 * @returns {Promise<{ title: string, icon: string }>}
 */
export async function fetchSiteInfo(pageUrl, opts = {}) {
  const info = (await hasSiteAccess(pageUrl)) ? await fetchFromSite(pageUrl, opts) : { title: '', icon: '' };
  if (!info.icon) info.icon = await fetchBrowserFavicon(pageUrl);
  return info;
}

/**
 * 从搜索引擎模板推导 origin
 * @param {string} tpl
 * @returns {string|null}
 */
export function extractOriginFromTemplate(tpl) {
  try {
    const probe = tpl.includes('%s') ? tpl.replace('%s', 'test') : tpl;
    return new URL(probe).origin;
  } catch {
    return null;
  }
}
