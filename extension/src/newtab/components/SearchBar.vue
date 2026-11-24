<template>
  <form
    ref="formEl"
    class="search"
    @submit.prevent="onSubmit"
    @click="onFormClick"
  >
    <div class="engine-wrap">
      <button
        ref="engineBtn"
        class="engine"
        type="button"
        :title="engines.defaultEngine.name"
        aria-haspopup="listbox"
        :aria-expanded="showList"
        @click="toggleList"
      >
        <img
          v-if="engines.defaultEngine.icon"
          class="logo"
          :src="engines.defaultEngine.icon"
          alt=""
        />
        <span v-else>{{ engines.defaultEngine.name.slice(0, 1) }}</span>
      </button>
      <teleport to="body">
        <div
          v-if="showList"
          class="engine-list"
          :style="menuStyle"
          role="listbox"
          @click.stop
        >
          <button
            v-for="e in engines.list"
            :key="e.id"
            type="button"
            class="engine-item"
            role="option"
            :aria-selected="e.id === engines.defaultEngine.id"
            @click="choose(e.id)"
          >
            <img
              v-if="e.icon"
              class="logo sm"
              :src="e.icon"
              alt=""
            />
            <span v-else class="dot">{{ e.name.slice(0, 1) }}</span>
            <span class="nm">{{ e.name }}</span>
          </button>
        </div>
      </teleport>
    </div>
    <input
      ref="inputEl"
      v-model="q"
      type="text"
      placeholder="搜索，或输入书签名称"
      aria-label="搜索"
      role="combobox"
      aria-autocomplete="list"
      aria-controls="gce-suggest"
      :aria-expanded="suggestOpen"
      :aria-activedescendant="activeIndex >= 0 ? `gce-suggest-${activeIndex}` : undefined"
      @focus="focused = true"
      @blur="focused = false"
      @keydown="onInputKey"
    />
    <!-- 书签联想：teleport 到 body，避免被 .search 的 backdrop-filter 层叠上下文裁剪 -->
    <teleport to="body">
      <ul
        v-if="suggestOpen"
        id="gce-suggest"
        class="suggest"
        role="listbox"
        aria-label="匹配的书签"
        :style="suggestStyle"
        @pointerdown.prevent
      >
        <li
          v-for="(m, i) in suggestions"
          :id="`gce-suggest-${i}`"
          :key="m.bookmark.id"
          class="suggest-item"
          :class="{ on: i === activeIndex }"
          role="option"
          :aria-selected="i === activeIndex"
          @pointerenter="activeIndex = i"
          @click="openBookmark(m.bookmark)"
        >
          <span class="s-ico" :style="{ background: m.bookmark.color || 'var(--tile)' }">
            <img v-if="m.bookmark.icon" :src="m.bookmark.icon" alt="" />
            <template v-else>{{ (m.bookmark.title[0] || '站').toUpperCase() }}</template>
          </span>
          <span class="s-title">
            <template v-for="(part, k) in m.titleParts" :key="k">
              <mark v-if="part.hit">{{ part.text }}</mark>
              <template v-else>{{ part.text }}</template>
            </template>
          </span>
          <span class="s-host">{{ m.host }}</span>
          <span class="s-group">{{ groupName(m.bookmark.groupId) }}</span>
        </li>
        <li class="suggest-tip" aria-hidden="true">↑↓ 选择 · Enter 打开 · 不选择时 Enter 搜索</li>
      </ul>
    </teleport>
  </form>
</template>
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import type { CSSProperties } from 'vue';
import { useEngines } from '../../core/store/useEngines';
import { useSettings } from '../../core/store/useSettings';
import { useBookmarks } from '../../core/store/useBookmarks';
import { searchBookmarks } from '../../core/utils/bookmarkSearch';
import type { Bookmark } from '../../core/types/model';
import { notifyError } from '../../core/store/useStorage';
import { createResourceManager } from '../../core/utils/lifecycle';
import { toast } from '../../core/utils/feedback';

const engines = useEngines();
const settings = useSettings();
const bm = useBookmarks();
const rm = createResourceManager();

const q = ref('');
const inputEl = ref<HTMLInputElement | null>(null);
const engineBtn = ref<HTMLButtonElement | null>(null);
const showList = ref(false);
const menuPos = ref({ left: 0, top: 0 });

// ============ 书签联想 ============

const formEl = ref<HTMLFormElement | null>(null);
const focused = ref(false);
/** 当前高亮的联想项；-1 表示未选择（此时 Enter 执行搜索） */
const activeIndex = ref(-1);
const suggestPos = ref({ left: 0, top: 0, width: 0 });

const suggestions = computed(() => searchBookmarks(bm.bookmarks, q.value));
const suggestOpen = computed(() => focused.value && !showList.value && suggestions.value.length > 0);
const suggestStyle = computed<CSSProperties>(() => ({
  left: `${suggestPos.value.left}px`,
  top: `${suggestPos.value.top}px`,
  width: `${suggestPos.value.width}px`,
}));

function placeSuggest() {
  const r = formEl.value?.getBoundingClientRect();
  if (r) suggestPos.value = { left: Math.round(r.left), top: Math.round(r.bottom + 8), width: Math.round(r.width) };
}

watch(q, () => (activeIndex.value = -1));
watch(suggestOpen, (open) => {
  if (open) placeSuggest();
});

function groupName(id: string): string {
  return bm.groups.find((g) => g.id === id)?.name ?? '';
}

function openBookmark(b: Bookmark) {
  q.value = '';
  window.open(b.url, settings.settings.openMode === 'newtab' ? '_blank' : '_self');
}

function onInputKey(e: KeyboardEvent) {
  // 中文输入法选词期间的方向键 / Enter 属于输入法，不能拦截
  if (e.isComposing || !suggestOpen.value) return;
  const n = suggestions.value.length;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex.value = (activeIndex.value + 1) % n;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex.value = activeIndex.value <= 0 ? n - 1 : activeIndex.value - 1;
  } else if (e.key === 'Escape') {
    e.preventDefault();
    q.value = '';
  }
}

const menuStyle = computed<CSSProperties>(() => ({
  position: 'fixed',
  left: `${menuPos.value.left}px`,
  top: `${menuPos.value.top}px`,
  zIndex: 'var(--z-dropdown)',
}));

/**
 * 新标签页打开时浏览器会把焦点放在地址栏，页面脚本拿不到焦点；
 * 页面获得焦点后的几个时刻内多次尝试，且只在焦点不在其它控件上时抢焦点。
 */
function focusSoon() {
  for (const d of [0, 40, 120, 260, 520, 900]) {
    rm.setTimeout(() => {
      const el = inputEl.value;
      if (!el || showList.value || !document.hasFocus()) return;
      const ae = document.activeElement;
      if (ae && ae !== document.body && ae !== document.documentElement && ae !== el) return;
      el.focus({ preventScroll: true });
    }, d);
  }
}

onMounted(() => {
  void nextTick(focusSoon);
  rm.onWindow('focus', focusSoon, { capture: true });
  rm.onDocument('pointerdown', (e) => {
    if (!(e.target as Element)?.closest?.('.engine-wrap, .engine-list')) showList.value = false;
  }, { capture: true });
  rm.onWindow('resize', () => {
    if (suggestOpen.value) placeSuggest();
  });
  rm.onDocument('keydown', (e) => {
    if (showList.value && (e as KeyboardEvent).key === 'Escape') {
      showList.value = false;
      inputEl.value?.focus();
    }
  });
});

function onFormClick(e: MouseEvent) {
  if (!(e.target as Element).closest('.engine-wrap')) inputEl.value?.focus();
}

function toggleList() {
  showList.value = !showList.value;
  if (!showList.value) return;
  void nextTick(() => {
    const r = engineBtn.value?.getBoundingClientRect();
    if (!r) return;
    const listW = window.innerWidth < 768 ? 180 : 220;
    menuPos.value = {
      left: Math.max(8, Math.min(Math.round(r.left), window.innerWidth - listW - 8)),
      top: Math.round(r.bottom + 8),
    };
  });
}

async function choose(id: string) {
  showList.value = false;
  try {
    await engines.setDefault(id);
    toast(`已切换至：${engines.defaultEngine.name}`);
  } catch (err) {
    notifyError(err, '切换失败');
  }
  inputEl.value?.focus();
}

function onSubmit() {
  const picked = suggestOpen.value ? suggestions.value[activeIndex.value] : undefined;
  if (picked) {
    openBookmark(picked.bookmark);
    return;
  }
  const query = q.value.trim();
  if (!query) return;
  const url = engines.defaultEngine.template.replace('%s', encodeURIComponent(query));
  window.open(url, settings.settings.openMode === 'newtab' ? '_blank' : '_self');
}
</script>
<style scoped>
.search{ 
  display:flex; align-items:center; gap:8px;
  width:60vw; max-width:100%; height:56px; 
  /* 上下留白一致（均为 40px）：上方 = .wrap 的 padding-top 24px + 这里的 16px，下方 = 40px */
  margin: 16px auto 40px;
  background: var(--surface);
  border:1px solid var(--border);
  border-radius: 999px; padding: 0 8px 0 8px;
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(4px);
  transition: box-shadow var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
  /* 注意：此处不可设置 z-index。
     position:relative + z-index 会创建层叠上下文，把子元素 .engine-list 的
     z-index 钳制在本层级内，导致下拉列表被分组栏/卡片菜单遮罩盖住。
     position:relative 且 z-index:auto 不创建层叠上下文，下拉才能正常参与全局层级。 */
  position: relative;
  box-sizing: border-box;
}
.search:hover{ box-shadow: var(--shadow); transform: translateY(-1px); }
.engine-wrap{ position:relative }
.engine{ width:36px; height:36px; border-radius:50%; border:1px solid var(--border); background:var(--card); color:var(--text); display:flex; align-items:center; justify-content:center; cursor:pointer }
.engine .logo{ width:18px; height:18px; object-fit:contain; border-radius:4px; display:block }
.engine-list{ position:absolute; left:0; top:44px; background:var(--overlay); backdrop-filter: blur(6px); border:1px solid var(--border); border-radius:12px; padding:6px; box-shadow: var(--shadow); width:220px; z-index: var(--z-dropdown); pointer-events:auto }
.engine-item{ display:flex; align-items:center; gap:10px; width:100%; background:transparent; border:0; color:var(--text); padding:8px 10px; border-radius:8px; cursor:pointer }
.engine-item:hover{ background: var(--overlay-hover) }
.engine-item .dot{ width:20px; height:20px; border-radius:50%; background:var(--tile); display:flex; align-items:center; justify-content:center; font-size:12px; color:var(--on-accent) }
.engine-item .logo.sm{ width:16px; height:16px; object-fit:contain; border-radius:3px; display:block }
.engine-item .nm{ font-size:14px }
input{ flex:1; background:transparent; border:0; outline:none; padding:0 8px; color:var(--text); font-size:14px }
.suggest{ position:fixed; z-index:var(--z-dropdown); margin:0; padding:6px; list-style:none; box-sizing:border-box; background:var(--overlay); -webkit-backdrop-filter:blur(14px) saturate(160%); backdrop-filter:blur(14px) saturate(160%); border:1px solid var(--border); border-radius:16px; box-shadow:var(--shadow) }
.suggest-item{ display:flex; align-items:center; gap:10px; height:40px; padding:0 10px; border-radius:10px; color:var(--text); cursor:pointer }
.suggest-item.on{ background:var(--overlay-hover) }
.s-ico{ width:22px; height:22px; flex:none; border-radius:6px; overflow:hidden; display:flex; align-items:center; justify-content:center; color:var(--on-accent); font-size:12px; font-weight:600 }
.s-ico img{ width:100%; height:100%; object-fit:cover }
.s-title{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:14px }
.s-title mark{ background:transparent; color:var(--primary); font-weight:600 }
.s-host{ flex:none; max-width:36%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; color:var(--muted) }
.s-group{ flex:none; font-size:11px; color:var(--muted); padding:2px 8px; border-radius:var(--r-pill); background:var(--surface-hover) }
.s-group:empty{ display:none }
.suggest-tip{ padding:6px 10px 2px; font-size:11px; color:var(--muted); opacity:.8 }
/* ===== 移动端响应式 ===== */
@media (max-width: 768px) {
  .search { flex: 1; min-width: 0; width: auto; height: 44px; margin: 0; padding: 0 6px }
  input { font-size: 15px }
  .engine { width: 36px; height: 36px }
  .engine .logo { width: 16px; height: 16px }
  .engine-list { width: 180px }
  .s-host { display:none }
}
/* 触摸设备：扩大引擎按钮触摸区域 */
@media (hover: none) and (pointer: coarse) {
  .engine { width: 44px; height: 44px }
  .engine .logo { width: 20px; height: 20px }
  .engine-item { padding: 12px 10px; min-height: 44px; }
}

</style>
