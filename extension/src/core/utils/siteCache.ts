import { SITE_CACHE_KEY, SITE_CACHE_TTL_MS } from '../config';

export interface SiteInfo {
  title: string;
  icon: string;
  ts: number;
}

const MAX_ENTRIES = 300;

function local(): chrome.storage.LocalStorageArea {
  return chrome.storage.local;
}

async function readAll(): Promise<Record<string, SiteInfo>> {
  try {
    const res = await local().get(SITE_CACHE_KEY);
    const v = res[SITE_CACHE_KEY];
    // 旧版存的是 JSON 字符串
    const map = typeof v === 'string' ? JSON.parse(v) : v;
    return map && typeof map === 'object' ? (map as Record<string, SiteInfo>) : {};
  } catch {
    return {};
  }
}

/** 读取某个页面地址的有效缓存（过期返回 undefined） */
export async function getSiteCache(url: string): Promise<SiteInfo | undefined> {
  const hit = (await readAll())[url];
  if (!hit || Date.now() - hit.ts > SITE_CACHE_TTL_MS) return undefined;
  return hit;
}

/** 写入缓存：只缓存成功结果（旧版把「抓取失败」也缓存 7 天，手动重试被静默跳过） */
export async function setSiteCache(url: string, info: { title: string; icon: string }) {
  if (!info.icon && !info.title) return;
  const now = Date.now();
  const map = await readAll();
  map[url] = { ...info, ts: now };
  const kept = Object.entries(map)
    .filter(([, v]) => v && now - v.ts < SITE_CACHE_TTL_MS)
    .sort((a, b) => b[1].ts - a[1].ts)
    .slice(0, MAX_ENTRIES);
  try {
    await local().set({ [SITE_CACHE_KEY]: Object.fromEntries(kept) });
  } catch {
    /* 缓存写入失败不影响主流程 */
  }
}

export async function hasSiteCache(): Promise<boolean> {
  return Object.keys(await readAll()).length > 0;
}

export async function clearSiteCache(): Promise<void> {
  await local().remove(SITE_CACHE_KEY);
}
