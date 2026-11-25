/**
 * 检查更新：同时查询 GitHub 与 Gitee 上本项目的最新 Release，有新版本时提示用户下载。
 * 只能提醒、不能自动安装（以「加载已解压的扩展程序」方式安装的扩展，浏览器不会自动更新）。
 *
 * - GitHub 仓库取自 manifest.homepage_url；Gitee 是国内镜像（GITEE_REPO，与 README 中的镜像地址一致）
 * - 两个来源同时查询，哪个先返回先显示：访问不了 GitHub 的用户不必等它超时
 * - 两边版本相同时两个下载地址都保留；不同时取版本号高的
 * - 结果缓存 24 小时，多个新标签页共用；GitHub 未登录接口限额为每个 IP 每小时 60 次
 */
import { reactive } from 'vue';

const CACHE_KEY = 'gce_update_check';
const NOTIFIED_KEY = 'gce_update_notified';
const TTL_MS = 24 * 60 * 60 * 1000;
const GITEE_REPO = 'coolteam/gce';
const GITEE_API = `https://gitee.com/api/v5/repos/${GITEE_REPO}/releases/latest`;
/** Gitee 上传的附件地址前缀（assets 中还有 Gitee 自动生成的源码包，位于 /archive/ 下） */
const GITEE_ASSET_PREFIX = `https://gitee.com/${GITEE_REPO}/releases/download/`;

type Source = 'github' | 'gitee';
type Downloads = Partial<Record<Source, string>>;

interface LatestRelease {
  /** 不带前缀 v 的版本号，如 1.2.0 */
  version: string;
  /** 各来源的下载地址：GitHub 为 Release 页面，Gitee 为附件直链 */
  downloads: Downloads;
}

/** 单个来源查到的结果 */
interface Found {
  version: string;
  url: string;
}

export const updateState = reactive({
  checking: false,
  /** 是否完成过一次检查（含读取缓存） */
  checked: false,
  /** 已知的最新 Release（不一定比当前版本新） */
  release: null as LatestRelease | null,
  error: '',
});

const currentVersion = (): string => chrome.runtime.getManifest().version;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 解析 1.2.3 / v1.2.3；不是纯数字版本号时返回 null */
function parseVersion(v: string): number[] | null {
  const m = /^v?(\d+(?:\.\d+)*)$/i.exec(v.trim());
  return m ? m[1].split('.').map(Number) : null;
}

const stripV = (v: string) => v.trim().replace(/^v/i, '');

/** a > b 返回正数，a < b 返回负数，相等返回 0；任一无法解析返回 null */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** 当前已知的最新 Release 比已安装版本新时返回它 */
export function availableUpdate(): LatestRelease | null {
  const r = updateState.release;
  return r && (compareVersions(r.version, currentVersion()) ?? 0) > 0 ? r : null;
}

// ============ 两个来源的返回格式 ============

/** GitHub：使用 Release 页面地址 html_url */
export function parseGithubRelease(data: unknown): Found | null {
  if (!isRecord(data) || typeof data.tag_name !== 'string' || typeof data.html_url !== 'string') return null;
  if (!parseVersion(data.tag_name) || !data.html_url.startsWith('https://github.com/')) return null;
  return { version: stripV(data.tag_name), url: data.html_url };
}

/** Gitee：返回数据中没有 Release 页面地址，使用上传的附件直链 */
export function parseGiteeRelease(data: unknown): Found | null {
  if (!isRecord(data) || typeof data.tag_name !== 'string' || !parseVersion(data.tag_name)) return null;
  const assets = Array.isArray(data.assets) ? data.assets : [];
  for (const a of assets) {
    const url = isRecord(a) ? a.browser_download_url : undefined;
    if (typeof url === 'string' && url.startsWith(GITEE_ASSET_PREFIX)) return { version: stripV(data.tag_name), url };
  }
  return null;
}

const one = (src: Source, url: string): Downloads => (src === 'github' ? { github: url } : { gitee: url });

/** 把一个来源的结果并入当前结果：版本更高则替换，相同则补充下载地址，更低则忽略 */
export function mergeFound(cur: LatestRelease | null, src: Source, f: Found): LatestRelease {
  const cmp = cur ? (compareVersions(f.version, cur.version) ?? -1) : 1;
  if (!cur || cmp > 0) return { version: f.version, downloads: one(src, f.url) };
  if (cmp === 0) return { version: cur.version, downloads: { ...cur.downloads, ...one(src, f.url) } };
  return cur;
}

interface SourceDef {
  id: Source;
  name: string;
  api: string;
  headers: Record<string, string>;
  parse: (data: unknown) => Found | null;
}

function sources(): SourceDef[] {
  const list: SourceDef[] = [{ id: 'gitee', name: 'Gitee', api: GITEE_API, headers: {}, parse: parseGiteeRelease }];
  const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)\/?$/.exec(chrome.runtime.getManifest().homepage_url ?? '');
  if (m) {
    list.unshift({
      id: 'github',
      name: 'GitHub',
      api: `https://api.github.com/repos/${m[1]}/${m[2]}/releases/latest`,
      headers: { Accept: 'application/vnd.github+json' },
      parse: parseGithubRelease,
    });
  }
  return list;
}

/** 返回 null 表示仓库还没有正式 Release（接口 404） */
async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, credentials: 'omit', signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ============ 缓存 ============

function sanitizeRelease(v: unknown): LatestRelease | null {
  if (!isRecord(v) || typeof v.version !== 'string' || !parseVersion(v.version) || !isRecord(v.downloads)) return null;
  const { github, gitee } = v.downloads;
  const downloads: Downloads = {};
  if (typeof github === 'string' && github.startsWith('https://github.com/')) downloads.github = github;
  if (typeof gitee === 'string' && gitee.startsWith(GITEE_ASSET_PREFIX)) downloads.gitee = gitee;
  return downloads.github || downloads.gitee ? { version: v.version, downloads } : null;
}

function readCache(): { release: LatestRelease | null } | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!isRecord(raw) || typeof raw.at !== 'number' || Date.now() - raw.at > TTL_MS) return null;
    if (raw.release === null) return { release: null };
    const release = sanitizeRelease(raw.release);
    // 格式不对（如旧版缓存）视为未命中
    return release ? { release } : null;
  } catch {
    return null;
  }
}

/**
 * 检查更新
 * @param force 忽略 24 小时缓存（用户点击「立即检查」或刚开启开关时）
 */
export async function checkForUpdate(force = false): Promise<void> {
  if (updateState.checking) return;
  const cached = force ? null : readCache();
  if (cached) {
    updateState.release = cached.release;
    updateState.checked = true;
    return;
  }
  updateState.checking = true;
  updateState.error = '';
  updateState.release = null;
  const errors: string[] = [];
  let anyOk = false;
  await Promise.all(
    sources().map(async (s) => {
      try {
        const data = await fetchJson(s.api, s.headers);
        if (data !== null) {
          const found = s.parse(data);
          if (!found) throw new Error('无法识别 Release 数据（缺少版本号或安装包）');
          updateState.release = mergeFound(updateState.release, s.id, found);
        }
        anyOk = true;
      } catch (e) {
        errors.push(`${s.name}：${e instanceof Error ? e.message : String(e)}`);
      }
    })
  );
  updateState.checking = false;
  updateState.checked = anyOk;
  if (anyOk) localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), release: updateState.release }));
  else updateState.error = errors.join('；');
}

/** 同一个新版本只提醒一次：返回 true 表示这是第一次提醒 */
export function markNotified(version: string): boolean {
  if (localStorage.getItem(NOTIFIED_KEY) === version) return false;
  localStorage.setItem(NOTIFIED_KEY, version);
  return true;
}
