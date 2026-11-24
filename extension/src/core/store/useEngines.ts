import { defineStore } from 'pinia';
import { update } from './useStorage';
import { useSettings } from './useSettings';
import { fetchSiteInfo, extractOriginFromTemplate } from '../../../shared/favicon.js';
import { builtinEngines } from '../../../shared/model.js';
import type { SearchEngine } from '../types/model';

/** 抓取失败后的重试间隔：避免每次打开新标签页都对同一个失败站点发请求 */
const ICON_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

let iconTask: Promise<void> | null = null;

export const useEngines = defineStore('engines', {
  state: () => ({
    list: builtinEngines() as SearchEngine[],
  }),

  getters: {
    byId: (s) => new Map(s.list.map((e) => [e.id, e])),
    /** 当前默认引擎（设置中的 id 失效时回落到第一个） */
    defaultEngine(s): SearchEngine {
      const id = useSettings().settings.defaultSearchId;
      return s.list.find((e) => e.id === id) ?? s.list[0];
    },
  },

  actions: {
    apply(list: SearchEngine[]) {
      this.list = list;
    },

    async setDefault(id: string) {
      if (!this.list.some((e) => e.id === id)) return;
      await useSettings().patch({ defaultSearchId: id });
    },

    /** 为缺少图标的引擎补抓图标（启动后后台执行，同一时刻只跑一个任务） */
    ensureIcons(): Promise<void> {
      if (iconTask) return iconTask;
      iconTask = (async () => {
        const now = Date.now();
        const todo = this.list.filter(
          (e) => !e.icon && (!e.iconCheckedAt || now - e.iconCheckedAt > ICON_RETRY_MS)
        );
        if (!todo.length) return;
        const results = new Map<string, string>();
        for (const e of todo) {
          const origin = extractOriginFromTemplate(e.template);
          const { icon } = origin ? await fetchSiteInfo(origin, { wantTitle: false }) : { icon: '' };
          results.set(e.id, icon);
        }
        try {
          const res = await update(['engines'], ({ engines }) => ({
            engines: engines.map((e) => {
              if (!results.has(e.id) || e.icon) return e;
              const icon = results.get(e.id);
              return icon ? { ...e, icon, iconCheckedAt: now } : { ...e, iconCheckedAt: now };
            }),
          }));
          this.apply(res.engines);
        } catch (err) {
          console.warn('[GCE] 保存引擎图标失败', err);
        }
      })().finally(() => {
        iconTask = null;
      });
      return iconTask;
    },
  },
});
