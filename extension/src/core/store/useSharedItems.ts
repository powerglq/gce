import { defineStore } from 'pinia';
import { update, notifyError } from './useStorage';
import type { SharedItem } from '../types/model';

/** 按域名归类（Nav 分享内容的类型识别）。纯函数。 */
export function categorizeUrl(url: string): string {
  const lower = url.toLowerCase();
  if (/bilibili\.com|youtube\.com|youtu\.be|douyin\.com|ixigua\.com/.test(lower)) return '视频';
  if (/github\.com|gitee\.com|stackoverflow\.com|juejin\.cn|csdn\.net/.test(lower)) return '代码';
  if (/taobao\.com|jd\.com|pinduoduo\.com|amazon\./.test(lower)) return '商品';
  if (lower.includes('mp.weixin.qq.com')) return '公众号';
  if (/zhihu\.com|toutiao\.com|medium\.com|substack\.com/.test(lower)) return '文章';
  if (lower.endsWith('.pdf')) return '文档';
  return '链接';
}

export const useSharedItems = defineStore('sharedItems', {
  state: () => ({
    items: [] as SharedItem[],
  }),

  getters: {
    count: (s) => s.items.length,
    sorted: (s) => [...s.items].sort((a, b) => b.createdAt - a.createdAt),
  },

  actions: {
    apply(items: SharedItem[]) {
      this.items = items;
    },

    async removeItem(id: number) {
      try {
        const res = await update(['sharedItems'], ({ sharedItems }) => ({
          sharedItems: sharedItems.filter((i) => i.id !== id),
        }));
        this.apply(res.sharedItems);
      } catch (err) {
        notifyError(err);
      }
    },

    async clearAll() {
      try {
        const res = await update(['sharedItems'], () => ({ sharedItems: [] }));
        this.apply(res.sharedItems);
      } catch (err) {
        notifyError(err);
      }
    },
  },
});
