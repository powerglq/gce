<template>
  <div
    ref="dockEl"
    class="dock"
    :class="{ over, empty: !items.length }"
    @dragenter.prevent="dragDepth++"
    @dragleave="dragDepth = Math.max(0, dragDepth - 1)"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <div ref="listEl" class="dock-inner">
      <div
        v-for="b in items"
        :key="b.id"
        class="dock-item"
        :data-id="b.id"
        :title="b.title"
        @contextmenu.prevent="openMenu($event, b.id)"
      >
        <div
          class="ico"
          :style="{ background: b.icon && !imgError[b.id] ? 'transparent' : b.color || 'var(--tile)' }"
          @click="open(b)"
        >
          <img
            v-if="b.icon && !imgError[b.id]"
            :src="b.icon"
            alt=""
            @error="imgError[b.id] = true"
          />
          <span v-else>{{ (b.title?.[0] || '站').toUpperCase() }}</span>
        </div>
      </div>
    </div>
    <div v-if="!items.length" class="dock-hint">将链接拖到这里固定到 Dock</div>
  </div>
  <teleport to="body">
    <div
      v-if="menu.open"
      ref="menuEl"
      class="dock-menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @contextmenu.prevent
      @click.stop
    >
      <button type="button" class="menu-item danger" @click="removeFromDock">从 Dock 移除</button>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import Sortable from 'sortablejs';
import { useSettings } from '../../core/store/useSettings';
import { useBookmarks } from '../../core/store/useBookmarks';
import { notifyError } from '../../core/store/useStorage';
import { findByUrl, normalizeUrl } from '../../../shared/model.js';
import { dragging, endDrag, moveId, revertSortableMove } from '../../core/utils/dragState';
import { createResourceManager } from '../../core/utils/lifecycle';
import { toast } from '../../core/utils/feedback';
import type { Bookmark } from '../../core/types/model';

const settings = useSettings();
const bm = useBookmarks();
const rm = createResourceManager();

const dockEl = ref<HTMLElement | null>(null);
const listEl = ref<HTMLElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const dragDepth = ref(0);
const over = computed(() => dragDepth.value > 0);
const imgError = reactive<Record<string, boolean>>({});

/** 存储层保证 dockIds 只包含存在的书签，这里直接映射 */
const items = computed<Bookmark[]>(() => {
  const byId = new Map(bm.bookmarks.map((b) => [b.id, b]));
  return settings.dockIds.map((id) => byId.get(id)).filter((b): b is Bookmark => !!b);
});

// 图标变化后允许重新加载
watch(
  () => items.value.map((b) => b.icon),
  () => {
    for (const k of Object.keys(imgError)) delete imgError[k];
  }
);

function open(b: Bookmark) {
  window.open(b.url, settings.settings.openMode === 'newtab' ? '_blank' : '_self');
}

// ============ 右键菜单 ============

const menu = reactive({ open: false, x: 0, y: 0, id: '' });

function openMenu(e: MouseEvent, id: string) {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  Object.assign(menu, {
    open: true,
    id,
    x: Math.max(8, Math.min(vw - 160, e.clientX)),
    y: Math.max(8, Math.min(vh - 60, e.clientY)),
  });
}
function closeMenu() {
  menu.open = false;
  menu.id = '';
}
rm.onDocument('pointerdown', (e) => {
  if (menu.open && !menuEl.value?.contains(e.target as Node)) closeMenu();
}, { capture: true });
rm.onDocument('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Escape') closeMenu();
});

async function removeFromDock() {
  const id = menu.id;
  closeMenu();
  if (id) await settings.unpinDock(id);
}

// ============ 拖入：网格中的书签，或从其它网页 / 地址栏拖来的链接 ============

function urlFromDataTransfer(dt: DataTransfer | null): string {
  if (!dt) return '';
  for (const type of ['text/uri-list', 'text/plain']) {
    const line = (dt.getData(type) || '').split(/\r?\n/).find((l) => l && !l.startsWith('#')) || '';
    const url = normalizeUrl(line);
    if (url) return url;
  }
  const html = dt.getData('text/html');
  const href = /<a\s[^>]*href\s*=\s*["']([^"']+)["']/i.exec(html || '')?.[1] || '';
  return normalizeUrl(href);
}

async function onDrop(e: DragEvent) {
  dragDepth.value = 0;
  const drag = dragging.value;
  if (drag?.source === 'dock') return; // Dock 内部排序由 Sortable 处理
  try {
    let id = drag?.id || '';
    if (!id) {
      const url = urlFromDataTransfer(e.dataTransfer);
      if (!url) {
        toast('未获取到拖拽的链接');
        return;
      }
      const exist = findByUrl(bm.bookmarks, url);
      if (exist) {
        id = exist.id;
      } else {
        id = (await bm.addBookmark({ url, title: new URL(url).hostname })).id;
        // 后台补抓图标，不阻塞固定到 Dock
        bm.refreshIcon(id).catch(() => undefined);
      }
    }
    await settings.pinDock(id);
  } catch (err) {
    notifyError(err);
  }
}

// ============ Dock 内排序 / 拖出移除 ============

let sortable: Sortable | null = null;

onMounted(() => {
  if (!listEl.value) return;
  sortable = Sortable.create(listEl.value, {
    animation: 150,
    draggable: '.dock-item',
    setData(dt, el) {
      const b = items.value.find((x) => x.id === el.dataset.id);
      if (b) {
        dt.setData('text/uri-list', b.url);
        dt.setData('text/plain', b.url);
      }
    },
    onStart(evt) {
      const id = (evt.item as HTMLElement).dataset.id;
      if (id) dragging.value = { id, source: 'dock' };
    },
    onUpdate(evt) {
      const from = evt.oldDraggableIndex;
      const to = evt.newDraggableIndex;
      revertSortableMove(evt);
      if (from === undefined || to === undefined || from === to) return;
      void settings.setDock(moveId(items.value.map((b) => b.id), from, to));
    },
    onEnd(evt) {
      endDrag();
      // 松手位置在 Dock 之外：移出 Dock（拖到分组侧栏时由侧栏处理，并同样取消固定）
      const id = (evt.item as HTMLElement).dataset.id;
      const r = dockEl.value?.getBoundingClientRect();
      const oe = (evt as unknown as { originalEvent?: DragEvent }).originalEvent;
      if (!id || !r || !oe || !Number.isFinite(oe.clientX)) return;
      const pad = 6;
      const inside =
        oe.clientX >= r.left - pad && oe.clientX <= r.right + pad && oe.clientY >= r.top - pad && oe.clientY <= r.bottom + pad;
      // 拖到窗口外时 dragend 的坐标为 (0,0)，不视为拖出
      if (!inside && (oe.clientX !== 0 || oe.clientY !== 0)) void settings.unpinDock(id);
    },
  });
});

onBeforeUnmount(() => {
  sortable?.destroy();
  sortable = null;
});
</script>
<style scoped>
.dock{ position:fixed; left:50%; bottom:calc(16px + var(--safe-b, 0px)); transform: translateX(-50%); z-index:var(--z-dock); padding:8px 10px; border-radius:14px; border:1px solid var(--border); background: var(--surface); backdrop-filter: blur(8px); box-shadow: var(--shadow); pointer-events:auto; display:flex; align-items:center; gap:10px }

.dock.over{ outline:2px dashed var(--primary) }
.dock.empty{ min-width: 360px; min-height: 64px; }
.dock-inner{ display:flex; align-items:center; gap:10px }
.dock-item{ width:44px; height:44px; border-radius:12px; border:0; background: var(--card); color:var(--text); display:flex; align-items:center; justify-content:center; cursor:grab; box-shadow: var(--shadow) }
.dock-item:active{ cursor:grabbing }
.ico{ width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; overflow:hidden; background:var(--tile); color:var(--on-accent); font-weight:600; border:0 }
.ico img{ width:100%; height:100%; object-fit:cover }
.dock-hint{ color: var(--text); opacity:.7; font-size:12px; user-select:none }
/* 右键菜单 */
.dock-menu{ position: fixed; z-index:var(--z-dock-menu); background: var(--overlay); backdrop-filter: blur(8px); border:1px solid var(--border); border-radius:10px; padding:6px; min-width: 140px; box-shadow: var(--shadow) }

.dock-menu .menu-item{ display:block; width:100%; text-align:left; padding:6px 10px; background:transparent; border:0; color:var(--text); border-radius:8px; cursor:pointer }
.dock-menu .menu-item:hover{ background: var(--overlay-hover) }
.dock-menu .menu-item.danger{ color:var(--danger) }

/* ===== 移动端响应式 ===== */
@media (max-width: 768px) {
  .dock { max-width: calc(100vw - 24px); bottom: calc(10px + var(--safe-b, 0px)); padding: 6px 8px; border-radius: 12px }
  .dock-inner { overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none }
  .dock-inner::-webkit-scrollbar { display: none }
  .dock.empty { min-width: 200px; min-height: 52px }
  .dock-item { width: 40px; height: 40px; border-radius: 10px }
  .ico { width: 30px; height: 30px; border-radius: 6px; font-size: 13px }
}
/* 触摸设备：确保 44px 触摸区域 */
@media (hover: none) and (pointer: coarse) {
  .dock-item { width: 44px; height: 44px }
  .dock-menu .menu-item { padding: 12px 14px; min-height: 44px; font-size: 14px; }
}
</style>
