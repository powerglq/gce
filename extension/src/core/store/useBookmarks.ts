import { defineStore } from 'pinia';
import { update, UserError } from './useStorage';
import { useSettings } from './useSettings';
import {
  createBookmark,
  findByUrl,
  normalizeUrl,
  nextOrder,
  resolveGroupId,
  sortGroups,
} from '../../../shared/model.js';
import { uid } from '../../../shared/uid.js';
import { fetchSiteInfo } from '../../../shared/favicon.js';
import type { Bookmark, Group } from '../types/model';

type Snapshot = { bookmarks: Bookmark[]; groups: Group[]; settings: import('../types/model').Settings };
type Mutator = (cur: Snapshot) => Partial<Snapshot> | void;

export interface BookmarkInput {
  url: string;
  title?: string;
  icon?: string;
  color?: string;
  groupId?: string;
}

/** 批量获取图标时的并发数（避免同时向大量网站发请求） */
const ICON_CONCURRENCY = 4;

export const useBookmarks = defineStore('bookmarks', {
  state: () => ({
    ready: false,
    bookmarks: [] as Bookmark[],
    groups: [] as Group[],
  }),

  getters: {
    groupsSorted: (s): Group[] => sortGroups(s.groups),
    /** 分组 id → 组内书签（已按 order 排序） */
    byGroup: (s): Map<string, Bookmark[]> => {
      const map = new Map<string, Bookmark[]>();
      for (const b of s.bookmarks) {
        const list = map.get(b.groupId);
        if (list) list.push(b);
        else map.set(b.groupId, [b]);
      }
      for (const list of map.values()) list.sort((a, b) => a.order - b.order);
      return map;
    },
  },

  actions: {
    /** 应用来自存储的数据（启动加载 / 其它上下文的写入） */
    apply(part: { bookmarks?: Bookmark[]; groups?: Group[] }) {
      if (part.groups) this.groups = part.groups;
      if (part.bookmarks) this.bookmarks = part.bookmarks;
      this.ready = true;
    },

    /** 统一写入入口：锁内基于最新数据计算，成功后用写入结果刷新内存 */
    async commit(mutator: Mutator) {
      const res = await update(['bookmarks'], mutator);
      this.apply(res);
      useSettings().apply({ settings: res.settings });
      return res;
    },

    // ============ 分组 ============

    async addGroup(name: string, icon?: string): Promise<string> {
      const id = uid('gp-');
      await this.commit(({ groups }) => {
        const order = groups.reduce((m, g) => Math.max(m, g.order), 0) + 10;
        return { groups: [...groups, { id, name: name.trim(), order, ...(icon ? { icon } : {}) }] };
      });
      return id;
    },

    async updateGroup(id: string, patch: Partial<Pick<Group, 'name' | 'icon'>>) {
      await this.commit(({ groups }) => ({
        groups: groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
      }));
    },

    /**
     * 删除分组
     * @param withBookmarks true：连同组内书签一起删除（一次写入）；false：组内有书签时拒绝
     */
    async removeGroup(id: string, withBookmarks = false) {
      await this.commit(({ groups, bookmarks }) => {
        const inGroup = bookmarks.filter((b) => b.groupId === id);
        if (inGroup.length && !withBookmarks) throw new UserError('请先转移该组中的链接');
        return {
          groups: groups.filter((g) => g.id !== id),
          bookmarks: bookmarks.filter((b) => b.groupId !== id),
        };
      });
    },

    // ============ 书签 ============

    async addBookmark(data: BookmarkInput): Promise<Bookmark> {
      const url = normalizeUrl(data.url);
      if (!url) throw new UserError('请输入以 http(s):// 开头的链接');
      let created: Bookmark | undefined;
      await this.commit(({ bookmarks, groups }) => {
        const exist = findByUrl(bookmarks, url);
        if (exist) throw new UserError(`该链接已存在：${exist.title}`);
        created = createBookmark(
          { ...data, url, groupId: resolveGroupId(groups, data.groupId) },
          bookmarks
        );
        return { bookmarks: [...bookmarks, created] };
      });
      return created as Bookmark;
    },

    /**
     * 修改书签；groupId 变化时移到目标分组末尾
     * icon / color 传 '' 表示清除
     */
    async updateBookmark(id: string, patch: BookmarkInput) {
      const url = patch.url !== undefined ? normalizeUrl(patch.url) : undefined;
      if (patch.url !== undefined && !url) throw new UserError('请输入以 http(s):// 开头的链接');
      await this.commit(({ bookmarks, groups }) => {
        const cur = bookmarks.find((b) => b.id === id);
        if (!cur) throw new UserError('链接已被删除');
        if (url) {
          const dup = findByUrl(
            bookmarks.filter((b) => b.id !== id),
            url
          );
          if (dup) throw new UserError(`该链接已存在：${dup.title}`);
        }
        const next: Bookmark = { ...cur, updatedAt: Date.now() };
        if (url) next.url = url;
        if (patch.title !== undefined) next.title = patch.title.trim() || next.url;
        if (patch.icon !== undefined) {
          if (patch.icon) next.icon = patch.icon;
          else delete next.icon;
        }
        if (patch.color !== undefined) {
          if (patch.color) next.color = patch.color;
          else delete next.color;
        }
        if (patch.groupId !== undefined) {
          const gid = resolveGroupId(groups, patch.groupId);
          if (gid !== cur.groupId) {
            next.groupId = gid;
            next.order = nextOrder(bookmarks, gid);
          }
        }
        return { bookmarks: bookmarks.map((b) => (b.id === id ? next : b)) };
      });
    },

    /** 删除书签（Dock 中的引用由存储层统一清理） */
    async removeBookmark(id: string) {
      await this.commit(({ bookmarks }) => ({ bookmarks: bookmarks.filter((b) => b.id !== id) }));
    },

    /** 组内排序：按给定 id 顺序重排该组的 order */
    async reorderWithinGroup(groupId: string, idsInOrder: string[]) {
      await this.commit(({ bookmarks }) => {
        const rank = new Map<string, number>();
        idsInOrder.forEach((id, i) => rank.set(id, (i + 1) * 10));
        // 拖拽期间其它上下文新增的书签排在末尾
        let tail = (idsInOrder.length + 1) * 10;
        const inGroup = bookmarks
          .filter((b) => b.groupId === groupId)
          .sort((a, b) => a.order - b.order);
        const orderOf = new Map<string, number>();
        for (const b of inGroup) {
          const r = rank.get(b.id);
          orderOf.set(b.id, r ?? tail);
          if (r === undefined) tail += 10;
        }
        return {
          bookmarks: bookmarks.map((b) => (orderOf.has(b.id) ? { ...b, order: orderOf.get(b.id) as number } : b)),
        };
      });
    },

    /** 跨组移动：放到目标分组末尾 */
    async moveToGroup(id: string, targetGroupId: string) {
      await this.commit(({ bookmarks, groups }) => {
        const cur = bookmarks.find((b) => b.id === id);
        if (!cur) throw new UserError('链接已被删除');
        if (!groups.some((g) => g.id === targetGroupId)) throw new UserError('目标分组不存在');
        if (cur.groupId === targetGroupId) return;
        const order = nextOrder(bookmarks, targetGroupId);
        return {
          bookmarks: bookmarks.map((b) =>
            b.id === id ? { ...b, groupId: targetGroupId, order, updatedAt: Date.now() } : b
          ),
        };
      });
    },

    /** 写入单个书签的图标（书签已被删除时忽略） */
    async setIcon(id: string, icon: string) {
      await this.commit(({ bookmarks }) => {
        if (!bookmarks.some((b) => b.id === id)) return;
        return {
          bookmarks: bookmarks.map((b) => (b.id === id ? { ...b, icon, updatedAt: Date.now() } : b)),
        };
      });
    },

    /**
     * 重新获取图标（书签卡片菜单「获取图标」）
     * @returns 是否获取到新图标
     */
    async refreshIcon(id: string): Promise<boolean> {
      const target = this.bookmarks.find((b) => b.id === id);
      if (!target) throw new UserError('链接已被删除');
      const { icon } = await fetchSiteInfo(target.url, { wantTitle: false });
      if (!icon) return false;
      await this.setIcon(id, icon);
      return true;
    },

    /**
     * 批量重新获取某分类下所有书签的图标（分类菜单「更新图标」）
     * 并发获取；每拿到一个立即写入，卡片随之刷新；没获取到的保留原图标
     * @param onProgress 每处理完一个书签（无论成功与否）回调一次
     * @returns 成功更新的数量与总数
     */
    async refreshGroupIcons(
      groupId: string,
      onProgress?: (done: number, total: number) => void
    ): Promise<{ updated: number; total: number }> {
      const targets = this.bookmarks.filter((b) => b.groupId === groupId);
      let next = 0;
      let done = 0;
      let updated = 0;
      const worker = async () => {
        while (next < targets.length) {
          const b = targets[next++];
          try {
            const { icon } = await fetchSiteInfo(b.url, { wantTitle: false });
            if (icon) {
              await this.setIcon(b.id, icon);
              updated++;
            }
          } catch {
            /* 单个失败不影响其它书签 */
          }
          onProgress?.(++done, targets.length);
        }
      };
      await Promise.all(Array.from({ length: Math.min(ICON_CONCURRENCY, targets.length) }, worker));
      return { updated, total: targets.length };
    },
  },
});
