import { defineStore } from 'pinia';
import { update, UserError, notifyError } from './useStorage';
import { useSettings } from './useSettings';
import { createNotebookEntry } from '../../../shared/model.js';
import { dataURLToBlob } from '../utils/image';
import { deleteNotebookImage, putNotebookImage } from '../utils/imageAttachmentRepo';
import {
  NOTEBOOK_IMAGE_MAX_BYTES,
  NOTEBOOK_IMAGE_MAX_COUNT,
  NOTEBOOK_IMAGE_MAX_TOTAL_BYTES,
} from '../config';
import { uid } from '../../../shared/uid.js';
import { toast } from '../utils/feedback';
import type { NotebookEntry, NotebookImage, PanelPos } from '../types/model';

/** 输入防抖：停止输入 400ms 后写入；连续输入时最长 1.5s 必写一次 */
const SAVE_DELAY_MS = 400;
const SAVE_MAX_WAIT_MS = 1500;

/**
 * 本页尚未写入存储的条目改动（id → 字段）。
 * 写入时只覆盖这些条目的这些字段；同步其它标签页的数据时叠加这些改动，
 * 正在输入的内容不会被覆盖，其它条目也不会被本页的旧数据回滚。
 */
type Draft = Partial<Pick<NotebookEntry, 'content' | 'updatedAt' | 'panelPos'>>;
const drafts = new Map<string, Draft>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let firstDirtyAt = 0;
let saving: Promise<void> | null = null;

function overlay(list: NotebookEntry[]): NotebookEntry[] {
  if (!drafts.size) return list;
  return list.map((e) => (drafts.has(e.id) ? { ...e, ...drafts.get(e.id) } : e));
}

export const useNotebook = defineStore('notebook', {
  state: () => ({
    ready: false,
    entries: [] as NotebookEntry[],
    saving: false,
  }),

  getters: {
    currentId(s): string {
      const id = useSettings().settings.notebookCurrentId;
      return s.entries.some((e) => e.id === id) ? (id as string) : s.entries[0]?.id || '';
    },
    current(s): NotebookEntry | undefined {
      const id = this.currentId;
      return s.entries.find((e) => e.id === id);
    },
    currentContent(): string {
      return this.current?.content ?? '';
    },
    currentImages(): NotebookImage[] {
      return this.current?.images ?? [];
    },
  },

  actions: {
    apply(list: NotebookEntry[]) {
      this.entries = overlay(list);
      this.ready = true;
    },

    /** 统一写入：锁内基于最新列表计算 */
    async commit(mutator: (list: NotebookEntry[]) => NotebookEntry[] | void) {
      const res = await update(['notebooks'], ({ notebooks }) => {
        const next = mutator(notebooks);
        return next ? { notebooks: next } : undefined;
      });
      this.apply(res.notebooks);
      return res.notebooks;
    },

    // ============ 草稿（输入 / 面板位置） ============

    _markDirty(id: string, draft: Draft) {
      drafts.set(id, { ...drafts.get(id), ...draft });
      this.saving = true;
      const now = Date.now();
      if (!firstDirtyAt) firstDirtyAt = now;
      if (saveTimer) clearTimeout(saveTimer);
      const wait = now - firstDirtyAt >= SAVE_MAX_WAIT_MS ? 0 : SAVE_DELAY_MS;
      saveTimer = setTimeout(() => void this.flush(), wait);
    },

    setContent(content: string) {
      const e = this.current;
      if (!e) return;
      e.content = content;
      e.updatedAt = Date.now();
      this._markDirty(e.id, { content, updatedAt: e.updatedAt });
    },

    setPanelPos(left: number, top: number) {
      const e = this.current;
      if (!e) return;
      const panelPos: PanelPos = { left: Math.round(left), top: Math.round(top) };
      e.panelPos = panelPos;
      this._markDirty(e.id, { panelPos });
    },

    /** 立即写入所有草稿（切换条目 / 关闭面板 / 页面隐藏时调用） */
    async flush(): Promise<void> {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (saving) await saving;
      if (!drafts.size) {
        this.saving = false;
        return;
      }
      const snapshot = new Map(drafts);
      firstDirtyAt = 0;
      saving = (async () => {
        try {
          await this.commit((list) =>
            list.map((e) => (snapshot.has(e.id) ? { ...e, ...snapshot.get(e.id) } : e))
          );
          for (const [id, d] of snapshot) {
            const cur = drafts.get(id);
            if (cur && cur.content === d.content && cur.panelPos === d.panelPos) drafts.delete(id);
          }
        } catch (err) {
          notifyError(err);
        } finally {
          saving = null;
          this.saving = drafts.size > 0;
        }
      })();
      await saving;
    },

    // ============ 条目 ============

    async addEntry(name?: string): Promise<NotebookEntry | undefined> {
      const entry = createNotebookEntry({ name: name || `笔记 ${this.entries.length + 1}` });
      try {
        await this.commit((list) => [...list, entry]);
        await this.setCurrent(entry.id);
        return entry;
      } catch (err) {
        notifyError(err);
        return undefined;
      }
    },

    async removeEntry(id: string) {
      let removed: NotebookEntry | undefined;
      try {
        await this.commit((list) => {
          if (list.length <= 1) throw new UserError('至少保留一条笔记');
          removed = list.find((e) => e.id === id);
          return list.filter((e) => e.id !== id);
        });
      } catch (err) {
        notifyError(err);
        return;
      }
      drafts.delete(id);
      for (const img of removed?.images ?? []) void deleteNotebookImage(img.id).catch(() => undefined);
    },

    async renameEntry(id: string, name: string) {
      const n = name.trim();
      if (!n) return;
      try {
        await this.commit((list) => list.map((e) => (e.id === id ? { ...e, name: n } : e)));
      } catch (err) {
        notifyError(err);
      }
    },

    async setCurrent(id: string) {
      if (id === this.currentId) return;
      await this.flush();
      await useSettings().patch({ notebookCurrentId: id });
    },

    /** 按当前界面顺序移动条目 */
    async reorder(fromIndex: number, toIndex: number) {
      if (fromIndex === toIndex) return;
      const ids = this.entries.map((e) => e.id);
      if (fromIndex < 0 || fromIndex >= ids.length || toIndex < 0 || toIndex >= ids.length) return;
      const [moved] = ids.splice(fromIndex, 1);
      ids.splice(toIndex, 0, moved);
      const rank = new Map(ids.map((id, i) => [id, i]));
      try {
        await this.commit((list) =>
          list
            .slice()
            .sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity))
        );
      } catch (err) {
        notifyError(err);
      }
    },

    // ============ 图片附件（本体在 IndexedDB，存储中只保留元数据） ============

    async addImagesFromBlobs(blobs: Array<{ blob: Blob; name?: string }>) {
      const e = this.current;
      if (!e || !blobs.length) return;
      const cur = e.images;
      let slots = NOTEBOOK_IMAGE_MAX_COUNT - cur.length;
      if (slots <= 0) {
        toast(`图片数量已达上限（${NOTEBOOK_IMAGE_MAX_COUNT}）`);
        return;
      }
      let total = cur.reduce((sum, it) => sum + (it.size || 0), 0);
      const added: NotebookImage[] = [];
      for (const { blob, name } of blobs) {
        if (slots <= 0) break;
        if (!(blob instanceof Blob) || !/^image\//i.test(blob.type)) continue;
        if (blob.size > NOTEBOOK_IMAGE_MAX_BYTES) {
          toast(`单张图片过大（>${Math.round(NOTEBOOK_IMAGE_MAX_BYTES / 1024)}KB）`);
          continue;
        }
        if (total + blob.size > NOTEBOOK_IMAGE_MAX_TOTAL_BYTES) {
          toast(`图片总大小超限（>${Math.round(NOTEBOOK_IMAGE_MAX_TOTAL_BYTES / 1024 / 1024)}MB）`);
          break;
        }
        const img: NotebookImage = { id: uid('img-'), size: blob.size, mime: blob.type, createdAt: Date.now() };
        if (name) img.name = name;
        try {
          await putNotebookImage({ id: img.id, blob, name, size: blob.size, type: blob.type, createdAt: img.createdAt });
        } catch {
          toast('保存图片失败');
          continue;
        }
        added.push(img);
        total += blob.size;
        slots -= 1;
      }
      if (!added.length) return;
      const entryId = e.id;
      try {
        await this.commit((list) =>
          list.map((x) =>
            x.id === entryId ? { ...x, images: [...x.images, ...added], updatedAt: Date.now() } : x
          )
        );
      } catch (err) {
        notifyError(err);
        for (const img of added) void deleteNotebookImage(img.id).catch(() => undefined);
      }
    },

    async removeImage(imageId: string) {
      const entryId = this.current?.id;
      if (!entryId) return;
      try {
        await this.commit((list) =>
          list.map((x) =>
            x.id === entryId ? { ...x, images: x.images.filter((i) => i.id !== imageId) } : x
          )
        );
      } catch (err) {
        notifyError(err);
        return;
      }
      void deleteNotebookImage(imageId).catch(() => undefined);
    },

    /** 把旧数据中内联的 dataUrl 图片迁移到 IndexedDB（启动后执行一次） */
    async migrateLegacyImages() {
      const legacy: Array<{ entryId: string; img: NotebookImage }> = [];
      for (const e of this.entries) {
        for (const img of e.images) if (img.dataUrl) legacy.push({ entryId: e.id, img });
      }
      if (!legacy.length) return;
      const moved = new Set<string>();
      for (const { img } of legacy) {
        try {
          const blob = dataURLToBlob(img.dataUrl as string);
          await putNotebookImage({ id: img.id, blob, name: img.name, size: img.size || blob.size, type: blob.type, createdAt: img.createdAt });
          moved.add(img.id);
        } catch {
          /* 单张失败保留原数据，下次启动再试 */
        }
      }
      if (!moved.size) return;
      try {
        await this.commit((list) =>
          list.map((e) => ({
            ...e,
            images: e.images.map((i) => {
              if (!moved.has(i.id)) return i;
              const { dataUrl: _drop, ...rest } = i;
              return rest;
            }),
          }))
        );
      } catch (err) {
        console.warn('[GCE] 迁移笔记图片失败', err);
      }
    },
  },
});
