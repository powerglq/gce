/**
 * 搜索框书签联想：按输入匹配本地书签（标题 / 域名 / 网址）
 *
 * 规则：
 * - 不区分大小写；输入按空白拆成多个词，每个词都必须命中（标题或网址任一处）
 * - 每个词按命中位置打分：标题完全相同 > 标题开头 > 域名开头 > 标题包含 > 域名包含 > 网址包含
 * - 总分相同的，标题短的在前（更可能是用户要找的那个）
 */
import type { Bookmark } from '../types/model';

export interface TitlePart {
  text: string;
  hit: boolean;
}

export interface BookmarkMatch {
  bookmark: Bookmark;
  /** 去掉 www. 的域名，用于展示 */
  host: string;
  /** 标题拆分为命中 / 未命中片段，用于高亮（不使用 v-html） */
  titleParts: TitlePart[];
  score: number;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function termScore(term: string, title: string, host: string, url: string): number {
  if (title === term) return 100;
  if (title.startsWith(term)) return 80;
  if (host.startsWith(term)) return 70;
  if (title.includes(term)) return 60;
  if (host.includes(term)) return 50;
  if (url.includes(term)) return 30;
  return 0;
}

/** 把每个词在标题中的第一次出现标记出来，合并重叠区间 */
function splitTitle(title: string, terms: string[]): TitlePart[] {
  const lower = title.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0) ranges.push([i, i + t.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const parts: TitlePart[] = [];
  let pos = 0;
  for (const [start, end] of merged) {
    if (start > pos) parts.push({ text: title.slice(pos, start), hit: false });
    parts.push({ text: title.slice(start, end), hit: true });
    pos = end;
  }
  if (pos < title.length) parts.push({ text: title.slice(pos), hit: false });
  return parts;
}

export function searchBookmarks(list: readonly Bookmark[], query: string, limit = 6): BookmarkMatch[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const out: BookmarkMatch[] = [];
  for (const b of list) {
    const title = b.title.toLowerCase();
    const host = hostOf(b.url);
    const url = b.url.toLowerCase();
    let score = 0;
    for (const t of terms) {
      const s = termScore(t, title, host, url);
      if (!s) {
        score = 0;
        break;
      }
      score += s;
    }
    if (score) out.push({ bookmark: b, host, titleParts: splitTitle(b.title, terms), score });
  }
  out.sort((a, b) => b.score - a.score || a.bookmark.title.length - b.bookmark.title.length);
  return out.slice(0, limit);
}
