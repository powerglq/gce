import { defineStore } from 'pinia';
import { update, read, notifyError } from './useStorage';
import { defaultSettings, applySettingsPatch, sanitizeFab } from '../../../shared/model.js';
import type { FabState, Settings } from '../types/model';

type SettingsPatch = { [K in keyof Settings]?: Settings[K] | undefined };

/**
 * 本页尚未写入存储的设置改动（键 → 值；undefined 表示删除该键）。
 *
 * 为什么需要：滑块拖动是防抖写入的。防抖期间若收到其它标签页的同步，
 * 旧实现会用存储中的旧值覆盖内存，随后防抖触发时又把旧值写回——
 * 用户刚拖好的值被回滚。现在同步时先叠加未提交的本地改动。
 */
const pending = new Map<string, unknown>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;
let waiters: Array<() => void> = [];

export const useSettings = defineStore('settings', {
  state: () => ({
    ready: false,
    settings: defaultSettings() as Settings,
    /** 自定义背景图 dataURL，'' 表示未设置 */
    background: '',
    fab: sanitizeFab(undefined) as FabState,
  }),

  getters: {
    dockIds: (s) => s.settings.dockIds,
  },

  actions: {
    /** 应用来自存储的数据（启动加载 / 其它上下文的写入） */
    apply(part: { settings?: Settings; background?: string; fab?: FabState }) {
      if (part.settings) {
        this.settings = pending.size
          ? applySettingsPatch(part.settings, Object.fromEntries(pending))
          : part.settings;
      }
      if (part.background !== undefined) this.background = part.background;
      if (part.fab) this.fab = part.fab;
      this.ready = true;
    },

    /**
     * 修改设置：内存立即生效，写入可防抖
     * @param patch 值为 undefined 的键表示恢复默认
     * @param delayMs 防抖时长；0 表示立即写入
     * @returns 写入完成（或失败）时 resolve
     */
    patch(patch: SettingsPatch, delayMs = 0): Promise<void> {
      this.settings = applySettingsPatch(this.settings, patch as Record<string, unknown>);
      for (const [k, v] of Object.entries(patch)) pending.set(k, v);
      if (flushTimer) clearTimeout(flushTimer);
      const done = new Promise<void>((resolve) => waiters.push(resolve));
      flushTimer = setTimeout(() => void this.flush(), delayMs);
      return done;
    },

    /** 立即写入所有未提交的改动（页面隐藏 / 关闭面板时调用） */
    async flush(): Promise<void> {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (flushing) await flushing;
      if (!pending.size) {
        const ws = waiters;
        waiters = [];
        ws.forEach((w) => w());
        return;
      }
      const snapshot = Object.fromEntries(pending);
      const ws = waiters;
      waiters = [];
      flushing = (async () => {
        try {
          const res = await update(['settings'], ({ settings }) => ({
            settings: applySettingsPatch(settings, snapshot),
          }));
          // 写入期间又被修改过的键保留在 pending 中，等待下一次写入
          for (const [k, v] of Object.entries(snapshot)) {
            if (pending.has(k) && pending.get(k) === v) pending.delete(k);
          }
          this.apply({ settings: res.settings });
        } catch (err) {
          for (const k of Object.keys(snapshot)) pending.delete(k);
          notifyError(err);
          try {
            this.apply(await read(['settings']));
          } catch {
            /* 读取也失败时保留内存值 */
          }
        } finally {
          flushing = null;
          ws.forEach((w) => w());
        }
      })();
      await flushing;
    },

    // ============ Dock ============

    /** 设置 Dock 列表（顺序即展示顺序）；不存在的书签 id 由存储层过滤 */
    async setDock(ids: string[]) {
      const dockIds = Array.from(new Set(ids.filter(Boolean)));
      this.settings = { ...this.settings, dockIds };
      try {
        const res = await update(['bookmarks'], ({ settings }) => ({
          settings: { ...settings, dockIds },
        }));
        this.apply({ settings: res.settings });
      } catch (err) {
        notifyError(err);
        this.apply(await read(['settings']));
      }
    },

    async pinDock(id: string) {
      if (this.settings.dockIds.includes(id)) return;
      try {
        const res = await update(['bookmarks'], ({ settings }) =>
          settings.dockIds.includes(id) ? undefined : { settings: { ...settings, dockIds: [...settings.dockIds, id] } }
        );
        this.apply({ settings: res.settings });
      } catch (err) {
        notifyError(err);
      }
    },

    async unpinDock(id: string) {
      if (!this.settings.dockIds.includes(id)) return;
      this.settings = { ...this.settings, dockIds: this.settings.dockIds.filter((x) => x !== id) };
      try {
        const res = await update(['bookmarks'], ({ settings }) => ({
          settings: { ...settings, dockIds: settings.dockIds.filter((x) => x !== id) },
        }));
        this.apply({ settings: res.settings });
      } catch (err) {
        notifyError(err);
        this.apply(await read(['settings']));
      }
    },

    // ============ 背景图 / 悬浮按钮 ============

    async setBackground(dataUrl: string) {
      const res = await update(['background'], () => ({ background: dataUrl }));
      this.apply({ background: res.background });
    },

    async setFabEnabled(enabled: boolean) {
      this.fab = { ...this.fab, enabled };
      try {
        const res = await update(['fab'], ({ fab }) => ({ fab: { ...fab, enabled } }));
        this.apply({ fab: res.fab });
      } catch (err) {
        notifyError(err);
        this.apply(await read(['fab']));
      }
    },
  },
});
