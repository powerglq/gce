<template>
  <!-- role="link" + tabindex：卡片可被 Tab 聚焦、Enter/Space 打开。
       不用 <a>：打开方式（当前页 / 新标签）由用户设置决定。 -->
  <div
    ref="rootEl"
    class="card"
    :title="bookmark.title"
    :style="cardStyle"
    :class="{ menuOpen: showMenu }"
    role="link"
    tabindex="0"
    @click="open"
    @keydown.enter.prevent="open"
    @keydown.space.prevent="open"
    @contextmenu.prevent="openMenuAt($event.clientX, $event.clientY)"
  >
    <button
      class="more"
      type="button"
      :aria-label="`${bookmark.title} 的更多操作`"
      :aria-expanded="showMenu"
      aria-haspopup="menu"
      @click.stop="toggleMenu"
      @keydown.stop
    >⋯</button>
    <div class="icon" :style="iconBoxStyle">
      <img
        v-if="bookmark.icon && !imgError"
        :src="bookmark.icon"
        alt=""
        decoding="async"
        @error="imgError = true"
      />
      <span v-else>{{ iconLetter }}</span>
    </div>
    <div v-if="settings.settings.showName" class="name">{{ bookmark.title }}</div>
  </div>
  <Teleport to="body">
    <div
      v-if="showMenu"
      class="card-menu-mask"
      @click="closeMenu()"
      @contextmenu.prevent="closeMenu()"
    ></div>
    <div
      v-if="showMenu"
      ref="menuEl"
      class="card-menu"
      :style="menuStyle"
      role="menu"
      aria-label="书签操作"
      @click.stop
      @keydown.esc.stop="closeMenu(true)"
    >
      <button role="menuitem" @click="edit">编辑</button>
      <button role="menuitem" :disabled="fetchingIcon" @click="refreshIcon">
        {{ fetchingIcon ? '获取中…' : '获取图标' }}
      </button>
      <button role="menuitem" @click="copy">复制链接</button>
      <button role="menuitem" class="danger" @click="remove">删除</button>
    </div>
  </Teleport>
</template>
<script lang="ts">
/** 所有卡片共享：同一时刻只允许一个卡片菜单打开 */
const openMenus = new Set<() => void>();
</script>
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { Bookmark } from '../../core/types/model';
import { useSettings } from '../../core/store/useSettings';
import { useBookmarks } from '../../core/store/useBookmarks';
import { notifyError } from '../../core/store/useStorage';
import { toast, confirm } from '../../core/utils/feedback';

const props = defineProps<{ bookmark: Bookmark }>();
const emit = defineEmits<{ (e: 'edit', b: Bookmark): void }>();
const settings = useSettings();
const bm = useBookmarks();

const iconLetter = computed(() => (props.bookmark.title?.[0] || '站').toUpperCase());
const cardStyle = computed(() => {
  const s = settings.settings;
  const alpha = s.cardOpacity ?? 0.5;
  return {
    borderRadius: `${s.radius}px`,
    background: `rgb(var(--paper) / ${alpha})`,
    borderColor: `rgb(var(--line) / ${Math.max(0.12, alpha)})`,
    padding: `${s.cardPadding}px`,
    width: `${Math.max(s.iconPx + s.cardPadding * 2, 100)}px`,
  };
});
const iconBoxStyle = computed(() => {
  const { radius, iconPx } = settings.settings;
  // 卡片圆角为 0 时图标也是方形；否则按比例缩小（0.67 倍）
  const iconRadius = radius === 0 ? 0 : Math.max(4, Math.round(radius * 0.67));
  return {
    width: `${iconPx}px`,
    height: `${iconPx}px`,
    borderRadius: `${iconRadius}px`,
    background: props.bookmark.color || 'var(--tile)',
  };
});

// 图片加载失败回退到首字母；图标变化后允许重新尝试
const imgError = ref(false);
watch(() => props.bookmark.icon, () => { imgError.value = false; });

function open() {
  window.open(props.bookmark.url, settings.settings.openMode === 'newtab' ? '_blank' : '_self');
}

// ============ 菜单 ============

const showMenu = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const menuPos = ref({ x: 0, y: 0 });
const MENU_W = 130;
const MENU_H = 170;

const menuStyle = computed(() => {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  return {
    left: `${Math.max(8, Math.min(menuPos.value.x, vw - MENU_W - 8))}px`,
    top: `${Math.max(8, Math.min(menuPos.value.y, vh - MENU_H - 8))}px`,
  };
});

function closeMenu(restoreFocus = false) {
  showMenu.value = false;
  openMenus.delete(closeSelf);
  if (restoreFocus) (rootEl.value?.querySelector('.more') as HTMLElement | null)?.focus();
}
const closeSelf = () => closeMenu();

function openMenuAt(x: number, y: number) {
  for (const close of openMenus) close();
  menuPos.value = { x, y };
  showMenu.value = true;
  openMenus.add(closeSelf);
  void nextTick(() => (menuEl.value?.querySelector('button') as HTMLElement | null)?.focus());
}

function toggleMenu(e: MouseEvent) {
  if (showMenu.value) {
    closeMenu(true);
    return;
  }
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  openMenuAt(r.left, r.bottom);
}

function edit() {
  closeMenu();
  emit('edit', props.bookmark);
}

const fetchingIcon = ref(false);
async function refreshIcon() {
  if (fetchingIcon.value) return;
  fetchingIcon.value = true;
  try {
    const ok = await bm.refreshIcon(props.bookmark.id);
    toast(ok ? '已更新图标' : '未获取到图标', { type: ok ? 'success' : 'warning' });
  } catch (err) {
    notifyError(err, '获取图标失败');
  } finally {
    fetchingIcon.value = false;
    closeMenu();
  }
}

async function copy() {
  closeMenu();
  try {
    await navigator.clipboard.writeText(props.bookmark.url);
    toast('已复制链接', { type: 'success' });
  } catch {
    toast('复制失败', { type: 'error' });
  }
}

async function remove() {
  closeMenu();
  const ok = await confirm({ title: '删除链接', message: `确定删除「${props.bookmark.title}」？`, confirmText: '删除', variant: 'danger' });
  if (!ok) return;
  try {
    await bm.removeBookmark(props.bookmark.id);
  } catch (err) {
    notifyError(err);
  }
}
</script>
<style scoped>
.card{ position:relative; display:flex; flex-direction:column; align-items:center; justify-content:center; border:1px solid var(--border); cursor:pointer; user-select:none; transition: transform .18s ease, box-shadow .18s ease, background-color .18s ease; backdrop-filter: blur(4px); min-width:0; box-sizing:border-box; gap:10px }
.card:hover{ transform: translateY(-1px); box-shadow: var(--shadow) }
.card:focus-visible{ outline:2px solid var(--primary); outline-offset:2px }
.icon{ display:flex; align-items:center; justify-content:center; color:var(--on-accent); font-weight:600; overflow:hidden }
.icon img{ width:100%; height:100%; object-fit: cover }
.icon span{ display:inline-block }
.name{ font-size:12px; color:var(--text); opacity:.8; width:100%; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:center; box-sizing:border-box; padding:0 2px }
.more{ position:absolute; top:6px; right:6px; width:24px; height:24px; border-radius:6px; border:1px solid var(--border); background:var(--card); color:var(--text); cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0; line-height:1; opacity:0; transition: opacity .2s ease }
.card:hover .more, .card.menuOpen .more, .more:focus-visible{ opacity:1 }
/* 触摸设备：始终显示菜单按钮 + 扩大触摸区域 */
@media (hover: none) and (pointer: coarse) {
  .more { opacity: .7; width: 36px; height: 36px; top: 2px; right: 2px; border-radius: 8px }
}
@media (max-width: 768px) {
  .name { font-size: 11px }
  .more { width: 32px; height: 32px; top: 4px; right: 4px; border-radius: 6px }
}
</style>
<style>
/* 全局样式：Teleport 到 body 的菜单 */
.card-menu-mask{ position:fixed; inset:0; z-index:var(--z-card-menu-mask) }
.card-menu{
  position:fixed; z-index:var(--z-card-menu-panel); display:flex; flex-direction:column; gap:4px;
  background:var(--menu); backdrop-filter: blur(10px);
  border:1px solid var(--divider); border-radius:10px; padding:6px;
  box-shadow: var(--shadow-lg); min-width:110px;
}
.card-menu button{
  background:transparent; border:0; color:var(--text);
  padding:7px 12px; text-align:left; border-radius:8px; cursor:pointer;
  white-space:nowrap; font-size:13px; transition: background .12s;
}
.card-menu button:hover{ background: var(--overlay-hover) }
.card-menu button:disabled{ opacity:.6; cursor:wait }
.card-menu .danger{ color: var(--danger) }
@media (hover: none) and (pointer: coarse) {
  .card-menu{ padding:8px; min-width:130px }
  .card-menu button{ padding:10px 14px; font-size:14px }
}
</style>
