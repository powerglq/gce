<template>
  <!-- 启动加载 -->
  <div v-if="!ready && !loadError" key="loading" class="app-loading">
    <div class="app-loading-dot"></div>
  </div>
  <!-- 读取失败：不用默认数据顶替，避免把空数据写回存储 -->
  <div v-else-if="loadError" class="app-error" role="alert">
    <p>{{ loadError }}</p>
    <button type="button" class="gce-btn gce-btn--primary" @click="reload">重新加载</button>
  </div>
  <template v-else>
    <div class="bg" :style="bgStyle"></div>
    <div class="wrap" :style="wrapStyle" @wheel.passive="onWheelSwitch">
      <div class="search-row" :class="{ 'with-widgets': widgetsOn }">
        <WidgetBar v-if="widgetsOn" />
        <SearchBar />
        <button type="button" class="mobile-group-btn" @click="mobileGroupOpen = !mobileGroupOpen">
          <span class="mg-label">{{ activeGroupName }}</span>
          <svg
            class="mg-arrow"
            :class="{ flip: mobileGroupOpen }"
            viewBox="0 0 12 12"
            width="10"
            height="10"
            aria-hidden="true"
          >
            <path
              d="M2.5 4.5L6 8l3.5-3.5"
              stroke="currentColor"
              stroke-width="1.5"
              fill="none"
              stroke-linecap="round"
            />
          </svg>
        </button>
        <div v-if="mobileGroupOpen" class="mobile-group-mask" @click="mobileGroupOpen = false"></div>
        <div v-if="mobileGroupOpen" class="mobile-group-list" @click.stop>
          <button
            v-for="g in bm.groupsSorted"
            :key="g.id"
            type="button"
            class="mg-item"
            :class="{ on: g.id === activeGroupId }"
            @click="activeGroupId = g.id; mobileGroupOpen = false"
          >{{ g.name }}</button>
        </div>
      </div>

      <!-- 分组切换：新旧内容同时过渡，按切换方向上下滑入（离场元素绝对定位，不占布局） -->
      <div class="grid-stage">
        <Transition :name="`group-${switchDir}`" :duration="{ enter: 620, leave: 220 }">
          <div :key="activeGroupId" class="grid-wrap">
            <BookmarkGrid :bookmarks="currentBookmarks" :group-id="activeGroupId" @edit="startEdit">
              <AddCard @add="startAdd" />
            </BookmarkGrid>
          </div>
        </Transition>
      </div>
      <div class="group-hint" :class="{ show: hintVisible }" aria-hidden="true">{{ hintText }}</div>

      <!-- 左下角：记事本 / 收纳箱 / 设置 -->
      <div v-if="!settingsOpen" class="btns-fixed">
        <button
          type="button"
          class="avatar"
          :title="themeTitle"
          :aria-label="themeTitle"
          @click="cycleTheme"
        >
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
            <path v-if="scheme === 'dark'" fill="currentColor" d="M20 15.3A8.5 8.5 0 0 1 8.7 4a8.5 8.5 0 1 0 11.3 11.3Z" />
            <g v-else-if="scheme === 'light'" fill="currentColor">
              <circle cx="12" cy="12" r="4.2" />
              <path d="M11 2h2v3h-2zM11 19h2v3h-2zM2 11h3v2H2zM19 11h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zM16.3 17.7l1.4-1.4 2.1 2.1-1.4 1.4zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1z" />
            </g>
            <path v-else fill="currentColor" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 2v14a7 7 0 0 1 0-14Z" />
          </svg>
        </button>
        <button
          type="button"
          class="avatar note"
          title="记事本"
          aria-label="记事本"
          @click="notebookOpen = true"
        >
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M7 3h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v12h10V5H7Z" />
            <path fill="currentColor" d="M9 8.2h6a.8.8 0 0 1 0 1.6H9a.8.8 0 1 1 0-1.6Zm0 3.3h6a.8.8 0 0 1 0 1.6H9a.8.8 0 0 1 0-1.6Zm0 3.3h3.6a.8.8 0 1 1 0 1.6H9a.8.8 0 0 1 0-1.6Z" />
            <path fill="currentColor" d="M4.6 7h1.2v2H4.6V7Zm0 4h1.2v2H4.6v-2Zm0 4h1.2v2H4.6v-2Z" />
          </svg>
        </button>
        <button
          type="button"
          class="avatar inbox"
          title="收纳箱"
          aria-label="收纳箱"
          @click="sharedItemsOpen = true"
        >
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M5 21h14a1 1 0 0 0 1-1v-9l-5-5H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1Zm6-14h3l3 3v8h-6V7Z" />
            <path fill="currentColor" d="M9 13h6v2H9v-2Z" opacity=".5" />
          </svg>
        </button>
        <button
          type="button"
          class="avatar"
          title="设置"
          aria-label="设置"
          @click="settingsOpen = true"
        >
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z" />
          </svg>
        </button>
      </div>

      <SettingsDrawer :open="settingsOpen" @close="settingsOpen = false" />
      <NotebookPanel :open="notebookOpen" @close="notebookOpen = false" />
      <SharedItemsPanel :open="sharedItemsOpen" @close="sharedItemsOpen = false" />

      <!-- 添加 / 编辑链接 -->
      <teleport to="body">
        <div v-if="showAdd" class="add-mask" @click="closeAdd"></div>
        <div
          v-if="showAdd"
          class="add-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-dialog-title"
          @click.stop
        >
          <header class="add-hdr">
            <button class="back" @click="closeAdd">返回</button>
            <strong id="add-dialog-title">{{ form.id ? '编辑链接' : '添加链接' }}</strong>
            <button class="done" :disabled="saving" @click="submitAdd">完成</button>
          </header>
          <div class="form">
            <label class="field">
              <span>链接</span>
              <div class="row">
                <input
                  ref="urlInput"
                  v-model="form.url"
                  placeholder="https://"
                  class="flex1"
                  @paste="onUrlPaste"
                  @blur="onUrlBlur"
                  @keydown.enter.prevent="submitAdd"
                />
                <button
                  type="button"
                  class="btn outline"
                  :disabled="fetching"
                  @click="fetchInfo(true)"
                >
                  {{ fetching ? '获取中…' : '获取图标' }}
                </button>
              </div>
            </label>
            <label class="field">
              <span>名称</span>
              <input
                v-model="form.title"
                placeholder="站点名称"
                @input="titleTouched = true"
                @keydown.enter.prevent="submitAdd"
              />
            </label>
            <div class="field">
              <span id="add-group-label">所属分组</span>
              <div
                class="group-chips"
                role="radiogroup"
                aria-labelledby="add-group-label"
                @keydown="onGroupKey"
              >
                <button
                  v-for="g in bm.groupsSorted"
                  :key="g.id"
                  type="button"
                  class="group-chip"
                  role="radio"
                  :data-id="g.id"
                  :class="{ on: g.id === selectedGroupId }"
                  :aria-checked="g.id === selectedGroupId"
                  :tabindex="g.id === selectedGroupId ? 0 : -1"
                  @click="form.groupId = g.id"
                >
                  <GroupIcon :name="g.icon" class="chip-ico" />
                  <span class="chip-name">{{ g.name }}</span>
                </button>
              </div>
            </div>
            <div class="tabs">
              <button :class="{ on: tab === 'online' }" @click="tab = 'online'">在线图标</button>
              <button :class="{ on: tab === 'solid' }" @click="tab = 'solid'">纯色图标</button>
              <button :class="{ on: tab === 'local' }" @click="tab = 'local'">本地上传</button>
            </div>
            <div class="icon-area">
              <template v-if="tab === 'online'">
                <div v-if="form.icon && iconSource === 'online'" class="preview img"><img :src="form.icon" alt="预览" /></div>
                <div v-else class="preview" :style="{ background: 'var(--tile)', color: 'var(--on-accent)' }">{{ previewLetter }}</div>
                <p class="tip">输入链接后会自动获取网站图标；获取失败时显示名称首字母。</p>
              </template>
              <template v-else-if="tab === 'solid'">
                <div class="preview" :style="{ background: form.color }">{{ previewLetter }}</div>
                <div class="palette">
                  <button
                    v-for="c in PRESET_COLORS"
                    :key="c"
                    type="button"
                    class="dot"
                    :style="{ background: c }"
                    :title="c"
                    @click="form.color = c"
                  ></button>
                  <label class="dot custom" title="自定义颜色">
                    <input type="color" :value="form.color" @input="form.color = ($event.target as HTMLInputElement).value" />
                  </label>
                </div>
              </template>
              <template v-else>
                <div class="row tight">
                  <button type="button" class="btn outline" @click="fileInput?.click()">选择文件</button>
                  <input
                    ref="fileInput"
                    type="file"
                    accept="image/*"
                    style="display:none"
                    @change="onPickLocal"
                  />
                  <span class="filename">{{ iconFileName || '未选择任何文件' }}</span>
                </div>
                <div v-if="form.icon && iconSource === 'local'" class="preview img">
                  <img :src="form.icon" alt="预览" />
                </div>
              </template>
            </div>
          </div>
        </div>
      </teleport>
      <!-- 右侧分组侧栏 -->
      <GroupSidebar v-model="activeGroupId" />
    </div>
  </template>
  <!-- 底部 Dock（传送到 body，保证层级与可见性） -->
  <teleport to="body">
    <DockBar v-if="ready" />
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import SearchBar from './components/SearchBar.vue';
import WidgetBar from './components/WidgetBar.vue';
import BookmarkGrid from './components/BookmarkGrid.vue';
import AddCard from './components/AddCard.vue';
import SettingsDrawer from './components/SettingsDrawer.vue';
import NotebookPanel from './components/NotebookPanel.vue';
import SharedItemsPanel from './components/SharedItemsPanel.vue';
import GroupSidebar from './components/GroupSidebar.vue';
import DockBar from './components/DockBar.vue';
import GroupIcon from './components/GroupIcon.vue';
import { useBookmarks } from '../core/store/useBookmarks';
import { useSettings } from '../core/store/useSettings';
import { useNotebook } from '../core/store/useNotebook';
import { errorMessage, notifyError } from '../core/store/useStorage';
import { normalizeUrl } from '../../shared/model.js';
import { fetchSiteInfo } from '../../shared/favicon.js';
import { getSiteCache, setSiteCache } from '../core/utils/siteCache';
import { prepareIcon } from '../core/utils/image';
import { createResourceManager } from '../core/utils/lifecycle';
import { toast } from '../core/utils/feedback';
import { bootstrap, scheduleStartupMaintenance } from './appInit';
import { syncTheme } from '../core/theme/theme';
import type { Bookmark } from '../core/types/model';

const bm = useBookmarks();
const settings = useSettings();
syncTheme(() => settings.settings.colorScheme);

const widgetsOn = computed(() => {
  const w = settings.settings.widgets;
  return w.clock || w.date || w.lunar || w.weather;
});

/** 左下角主题按钮：深色 → 浅色 → 跟随系统 循环切换（与 设置 → 常规 → 主题 是同一个设置） */
const SCHEME_ORDER = ['dark', 'light', 'system'] as const;
const SCHEME_LABEL = { dark: '深色', light: '浅色', system: '跟随系统' } as const;
const scheme = computed(() => settings.settings.colorScheme);
const nextScheme = computed(() => SCHEME_ORDER[(SCHEME_ORDER.indexOf(scheme.value) + 1) % SCHEME_ORDER.length]);
const themeTitle = computed(() => `主题：${SCHEME_LABEL[scheme.value]}（点击切换为${SCHEME_LABEL[nextScheme.value]}）`);
function cycleTheme() {
  const next = nextScheme.value;
  void settings.patch({ colorScheme: next });
  toast(`主题：${SCHEME_LABEL[next]}`);
}
const notebook = useNotebook();
const rm = createResourceManager();

const ready = ref(false);
const loadError = ref('');
const settingsOpen = ref(false);
const notebookOpen = ref(false);
const sharedItemsOpen = ref(false);
const mobileGroupOpen = ref(false);

// ============ 启动 ============

function reload() {
  location.reload();
}

/** 页面隐藏 / 关闭时，把尚未写入的草稿（笔记输入、滑块）立即写入 */
function flushDrafts() {
  void notebook.flush();
  void settings.flush();
}

onMounted(async () => {
  try {
    await bootstrap();
  } catch (err) {
    console.error('[GCE] 启动失败', err);
    loadError.value = `${errorMessage(err, '⚠️ 数据读取失败')}，请重新加载页面`;
    return;
  }
  ready.value = true;
  scheduleStartupMaintenance();
  rm.onDocument('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDrafts();
  });
  rm.onWindow('pagehide', flushDrafts);
  rm.onDocument('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape' && showAdd.value) {
      e.preventDefault();
      closeAdd();
    }
  });
});

// ============ 分组与网格 ============

const activeGroupId = ref('');

watch(
  () => bm.groupsSorted.map((g) => g.id).join(','),
  () => {
    if (!bm.groups.some((g) => g.id === activeGroupId.value)) activeGroupId.value = bm.groupsSorted[0]?.id || '';
  },
  { immediate: true }
);

const activeGroupName = computed(() => bm.groups.find((g) => g.id === activeGroupId.value)?.name || '分组');
const currentBookmarks = computed(() => bm.byGroup.get(activeGroupId.value) ?? []);

/** 切换方向：决定新内容从下方（next）还是上方（prev）滑入 */
const switchDir = ref<'next' | 'prev'>('next');
const hintText = ref('');
const hintVisible = ref(false);
let hintTimer = 0;

// 默认 flush: 'pre'，在重新渲染之前执行，Transition 拿到的是本次切换的方向
watch(activeGroupId, (to, from) => {
  const list = bm.groupsSorted;
  const a = list.findIndex((g) => g.id === from);
  const b = list.findIndex((g) => g.id === to);
  switchDir.value = a >= 0 && b < a ? 'prev' : 'next';
  if (!from) return; // 启动时选中第一个分组，不提示
  hintText.value = activeGroupName.value;
  hintVisible.value = true;
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => (hintVisible.value = false), 900);
});

/** 切到相邻分组；到首尾时回弹，不循环 */
function switchGroupBy(dir: number) {
  const list = bm.groupsSorted;
  const next = list[list.findIndex((g) => g.id === activeGroupId.value) + dir];
  if (!next) {
    bounceGrid(dir);
    return;
  }
  activeGroupId.value = next.id;
  document.documentElement.scrollTop = 0;
}

function bounceGrid(dir: number) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document
    .querySelector<HTMLElement>('.grid-stage > .grid-wrap:not([class*="-leave-"])')
    ?.animate([{ transform: 'none' }, { transform: `translateY(${-dir * 14}px)` }, { transform: 'none' }], {
      duration: 320,
      easing: 'cubic-bezier(.3,.7,.4,1)',
    });
}

/**
 * 滚轮 / 触控板切换分组
 *
 * 一次滚动手势 = 间隔不超过 WHEEL_IDLE_MS 的连续 wheel 事件（含触控板惯性）。
 * - 输入类型按手势的第一个事件判定，手势内不变（触控板快划也会出现大的整数增量）
 * - 手势中页面发生过滚动：本次手势不切换，滚到底后的惯性不会顺带切组
 * - 鼠标滚轮（按格）：每格切一组，两次切换至少间隔 NOTCH_GAP_MS
 * - 触控板（连续小增量）：累计 TRACKPAD_THRESHOLD 切一组，之后锁定到手势结束
 */
const WHEEL_IDLE_MS = 140;
const NOTCH_GAP_MS = 260;
const TRACKPAD_THRESHOLD = 60;
const wheel = { kind: '' as '' | 'notch' | 'trackpad', acc: 0, locked: false, scrolled: false, idle: 0, lastSwitchAt: 0 };

function onWheelSwitch(e: WheelEvent) {
  if (Math.abs(e.deltaY) < Math.abs(e.deltaX) || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
  const el = document.documentElement;
  const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1);
  if (!dy) return;

  window.clearTimeout(wheel.idle);
  wheel.idle = window.setTimeout(() => Object.assign(wheel, { kind: '', acc: 0, locked: false, scrolled: false }), WHEEL_IDLE_MS);
  if (!wheel.kind) {
    wheel.kind = e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY)) ? 'notch' : 'trackpad';
  }

  const scrollable = el.scrollHeight > el.clientHeight + 2;
  const atEdge = !scrollable || (dy > 0 ? el.scrollTop + el.clientHeight >= el.scrollHeight - 1 : el.scrollTop <= 1);
  if (!atEdge) {
    wheel.scrolled = true;
    return;
  }
  if (wheel.scrolled || wheel.locked) return;

  if (wheel.kind === 'notch') {
    const now = performance.now();
    if (now - wheel.lastSwitchAt < NOTCH_GAP_MS) return;
    wheel.lastSwitchAt = now;
    switchGroupBy(Math.sign(dy));
    return;
  }
  wheel.acc += dy;
  if (Math.abs(wheel.acc) < TRACKPAD_THRESHOLD) return;
  wheel.locked = true;
  switchGroupBy(Math.sign(wheel.acc));
}

// ============ 背景 ============

const wrapStyle = computed(() => (settings.background ? { background: 'transparent' } : {}));
const bgStyle = computed(() => {
  const s = settings.settings;
  if (!settings.background) return { display: 'none' };
  const ov = s.backgroundOverlay ?? 0;
  const size = s.backgroundSize || 'cover';
  return {
    backgroundImage: `linear-gradient(rgba(0,0,0,${ov}), rgba(0,0,0,${ov})), url("${settings.background}")`,
    backgroundPosition: s.backgroundPosition || 'center',
    backgroundSize: size === 'tile' ? 'auto' : size,
    backgroundRepeat: size === 'tile' ? 'repeat' : 'no-repeat',
    filter: `blur(${s.backgroundBlur ?? 0}px)`,
  };
});

// ============ 添加 / 编辑链接 ============

const PRESET_COLORS = [
  '#f97316', '#f43f5e', '#ef4444', '#eab308', '#22c55e', '#10b981', '#06b6d4', '#0ea5e9',
  '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#94a3b8', '#475569', '#0f172a',
];

const showAdd = ref(false);
const saving = ref(false);
const fetching = ref(false);
const tab = ref<'online' | 'solid' | 'local'>('online');
const iconSource = ref<'online' | 'local' | ''>('');
const titleTouched = ref(false);
const iconFileName = ref('');
const urlInput = ref<HTMLInputElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const form = reactive({ id: '', url: '', title: '', icon: '', color: '#3b82f6', groupId: '' });

/** 表单中当前选中的分组（分组被删除或未设置时回落到第一个） */
const selectedGroupId = computed(() =>
  bm.groups.some((g) => g.id === form.groupId) ? form.groupId : bm.groupsSorted[0]?.id || ''
);

const GROUP_KEY_STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** 分组单选：方向键在分组间移动并聚焦（WAI-ARIA radiogroup 键盘交互） */
function onGroupKey(e: KeyboardEvent) {
  const step = GROUP_KEY_STEP[e.key];
  const list = bm.groupsSorted;
  if (!step || !list.length) return;
  e.preventDefault();
  // currentTarget 只在事件派发期间有效，必须在 nextTick 之前取出
  const root = e.currentTarget as HTMLElement;
  const i = Math.max(0, list.findIndex((g) => g.id === selectedGroupId.value));
  const next = list[(i + step + list.length) % list.length];
  form.groupId = next.id;
  void nextTick(() => root.querySelector<HTMLElement>(`[data-id="${CSS.escape(next.id)}"]`)?.focus());
}

const previewLetter = computed(() => {
  const t = form.title.trim();
  if (t) return t[0].toUpperCase();
  const url = normalizeUrl(form.url);
  return url ? new URL(url).hostname[0].toUpperCase() : '站';
});

function openForm() {
  iconFileName.value = '';
  showAdd.value = true;
  void nextTick(() => urlInput.value?.focus());
}

function startAdd() {
  Object.assign(form, { id: '', url: 'https://', title: '', icon: '', color: '#3b82f6', groupId: activeGroupId.value });
  tab.value = 'online';
  iconSource.value = '';
  titleTouched.value = false;
  openForm();
}

function startEdit(b: Bookmark) {
  Object.assign(form, { id: b.id, url: b.url, title: b.title, icon: b.icon || '', color: b.color || '#3b82f6', groupId: b.groupId });
  tab.value = b.color && !b.icon ? 'solid' : 'online';
  iconSource.value = b.icon ? 'online' : '';
  titleTouched.value = true;
  openForm();
}

function closeAdd() {
  showAdd.value = false;
}

/** 由域名推导一个占位名称：www.baidu.com → baidu */
function nameFromHost(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  return (parts.length > 1 ? parts[parts.length - 2] : parts[0]) || host;
}

/**
 * 获取网页标题与图标（同一页面地址 7 天内命中缓存）
 * @param manual 用户点击「获取图标」：给出结果提示
 */
async function fetchInfo(manual: boolean) {
  const url = normalizeUrl(form.url);
  if (!url) {
    if (manual) toast('请输入有效的 http(s) 链接');
    return;
  }
  if (fetching.value) return;
  fetching.value = true;
  try {
    let info = await getSiteCache(url);
    if (!info?.icon) {
      const r = await fetchSiteInfo(url);
      await setSiteCache(url, r);
      info = { ...r, ts: Date.now() };
    }
    if (normalizeUrl(form.url) !== url) return; // 抓取期间链接已被修改
    if (info.title && !titleTouched.value) form.title = info.title;
    if (info.icon) {
      form.icon = info.icon;
      iconSource.value = 'online';
      if (tab.value !== 'local') tab.value = 'online';
    }
    if (manual) toast(info.icon ? '已获取站点信息' : '未获取到图标，可改用纯色图标或本地上传', { type: info.icon ? 'success' : 'warning' });
  } finally {
    fetching.value = false;
  }
}

function onUrlBlur() {
  const url = normalizeUrl(form.url);
  if (!url) return;
  if (!form.title.trim() && !titleTouched.value) form.title = nameFromHost(new URL(url).hostname);
  void fetchInfo(false);
}

function onUrlPaste(e: ClipboardEvent) {
  const t = (e.clipboardData?.getData('text') || '').trim();
  if (!t) return;
  e.preventDefault();
  form.url = /^https?:\/\//i.test(t) ? t : `https://${t.replace(/^\/+/, '')}`;
  void nextTick(() => urlInput.value?.setSelectionRange(form.url.length, form.url.length));
}

async function onPickLocal(e: Event) {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  try {
    form.icon = await prepareIcon(f);
    iconSource.value = 'local';
    iconFileName.value = f.name;
  } catch (err) {
    toast((err as Error).message || '读取图片失败', { type: 'error' });
  }
}

async function submitAdd() {
  const url = normalizeUrl(form.url);
  if (!url) {
    toast('请输入以 http(s):// 开头的链接');
    return;
  }
  if (saving.value) return;
  saving.value = true;
  const data = {
    url,
    title: form.title.trim() || new URL(url).hostname,
    icon: tab.value === 'solid' ? '' : form.icon,
    color: tab.value === 'solid' ? form.color : '',
    groupId: form.groupId,
  };
  try {
    if (form.id) await bm.updateBookmark(form.id, data);
    else await bm.addBookmark(data);
    closeAdd();
  } catch (err) {
    notifyError(err);
  } finally {
    saving.value = false;
  }
}
</script>
<style scoped>
.group-chips{ display:flex; flex-wrap:wrap; gap:8px; max-height:132px; overflow-y:auto; padding:2px; scrollbar-width:thin }
.group-chip{ display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 12px; border-radius:var(--r-pill); border:1px solid var(--border); background:var(--card); color:var(--text); font-size:13px; cursor:pointer; transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out) }
.group-chip:hover{ background: var(--surface-active) }
.group-chip:focus-visible{ outline:2px solid var(--primary); outline-offset:2px }
.group-chip.on{ background: color-mix(in srgb, var(--primary) 26%, transparent); border-color: var(--primary); color:var(--text-strong) }
.chip-ico{ font-size:15px; opacity:.9 }
.chip-name{ max-width:9em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
@media (hover: none) and (pointer: coarse){ .group-chip{ height:40px; padding:0 14px; font-size:14px } }
.app-error{ position:fixed; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; background:var(--bg); color:var(--text); font-size:15px; z-index:var(--z-loading) }
/* ===== 启动 loading ===== */
.app-loading {
  display: flex; align-items: center; justify-content: center;
  height: 100vh; width: 100vw; background: var(--bg);
  position: fixed; inset: 0; z-index: var(--z-loading);
}
.app-loading-dot {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--primary);
  animation: gce-loading-pulse 0.9s ease-in-out infinite alternate;
}
@keyframes gce-loading-pulse {
  from { opacity: 0.2; transform: scale(0.85); }
  to { opacity: 1; transform: scale(1); }
}

.bg{ position:fixed; inset:0; background-position: center; background-size: cover; background-repeat:no-repeat; z-index:0; transform: translateZ(0) }
.wrap { position: relative; z-index: var(--z-base); min-height: 100%; padding: 24px; padding-bottom: 84px; box-sizing: border-box; max-width: 1440px; margin: 0 auto; padding-right: 120px; padding-left: 120px; }

.btns-fixed{ position:fixed; left:16px; bottom:calc(16px + var(--safe-b, 0px)); z-index:var(--z-float-btn); display:flex; flex-direction:column; gap:10px }
.avatar{ width:44px; height:44px; border-radius:50%; border:1px solid var(--border); background:var(--glass); backdrop-filter: blur(6px); color:var(--text); cursor:pointer; box-shadow: var(--shadow-sm); transition: transform .15s ease; display:flex; align-items:center; justify-content:center }
.avatar .ico{ width:20px; height:20px; display:block; }
.avatar:hover{ transform: translateY(-1px) }
.add-mask{ position:fixed; inset:0; background:var(--scrim); z-index:var(--z-modal-mask) }
.add-panel{ position:fixed; left:50%; top:50%; transform: translate(-50%, -50%); width:min(560px, 92vw); max-height:80vh; background:var(--glass); backdrop-filter: blur(6px); color:var(--text); border:1px solid var(--border); box-shadow: var(--shadow-lg); padding:16px; z-index:var(--z-modal); border-radius:var(--r-xl); overflow:auto }
.add-hdr{ display:flex; align-items:center; justify-content:space-between; margin-bottom:12px }
.back, .done{ border:1px solid var(--border); background:var(--card); color:var(--text); border-radius:8px; padding:6px 10px; cursor:pointer }
.form{ display:flex; flex-direction:column; gap:12px }
.field{ display:flex; flex-direction:column; gap:6px }
.field input{ height:38px; border-radius:10px; border:1px solid var(--border); background:var(--card); color:var(--text); padding:0 12px }
.form .row{ display:flex; align-items:center; gap:12px }
.flex1{ flex:1; min-width:0 }
.tabs{ display:flex; gap:8px }
.tabs button{ border:1px solid var(--border); background:var(--card); color:var(--text); border-radius:10px; padding:6px 10px; cursor:pointer }
.tabs .on{ outline:2px solid var(--primary) }
.grid-stage{ position:relative }
.grid-wrap{ will-change: opacity, transform }
.group-next-enter-active, .group-prev-enter-active{ transition: opacity .46s cubic-bezier(.16,1,.3,1), transform .46s cubic-bezier(.16,1,.3,1) }
.group-next-leave-active, .group-prev-leave-active{ position:absolute; top:0; left:0; right:0; pointer-events:none; transition: opacity .22s cubic-bezier(.4,0,1,1), transform .22s cubic-bezier(.4,0,1,1) }
.group-next-enter-from{ opacity:0; transform: translateY(64px) }
.group-prev-enter-from{ opacity:0; transform: translateY(-64px) }
.group-next-leave-to{ opacity:0; transform: translateY(-36px) scale(.985) }
.group-prev-leave-to{ opacity:0; transform: translateY(36px) scale(.985) }
/* 卡片依次入场（最多错开 17 个，避免书签多时尾部等待过久）；总时长与 Transition 的 enter duration 对齐 */
.group-next-enter-active :deep(.bm-item){ animation: card-in-next .38s cubic-bezier(.16,1,.3,1) both; animation-delay: calc(min(var(--i, 0), 17) * 14ms) }
.group-prev-enter-active :deep(.bm-item){ animation: card-in-prev .38s cubic-bezier(.16,1,.3,1) both; animation-delay: calc(min(var(--i, 0), 17) * 14ms) }
@keyframes card-in-next{ from{ opacity:0; transform: translateY(14px) scale(.96) } }
@keyframes card-in-prev{ from{ opacity:0; transform: translateY(-14px) scale(.96) } }
/* 切换时短暂显示分组名 */
.group-hint{ position:fixed; left:50%; bottom:calc(100px + var(--safe-b, 0px)); transform:translate(-50%, 8px); padding:8px 18px; border-radius:var(--r-pill); font-size:13px; color:var(--text); pointer-events:none; opacity:0; z-index:var(--z-float-btn); background:var(--glass); -webkit-backdrop-filter:blur(14px) saturate(160%); backdrop-filter:blur(14px) saturate(160%); border:1px solid rgb(var(--ink) / .18); box-shadow:var(--shadow-sm); transition: opacity .2s var(--ease-out), transform .25s var(--ease-out) }
.group-hint.show{ opacity:1; transform:translate(-50%, 0) }
.icon-area{ display:flex; flex-direction:column; gap:8px }
.icon-area .row{ display:flex; align-items:center; gap:8px }
.preview{ width:48px; height:48px; border-radius:12px; display:flex; align-items:center; justify-content:center; overflow:hidden }
.preview.img img{ width:100%; height:100%; object-fit:cover }
.tip{ opacity:.7; font-size:12px }

.btn{ padding:8px 12px; border-radius:10px; cursor:pointer; border:1px solid var(--border); background:var(--card); color:var(--text) }

.btn.outline{ background: var(--card) }
.palette{ display:flex; flex-wrap:wrap; gap:8px }
.palette .dot{ width:22px; height:22px; border-radius:50%; border:1px solid var(--border); cursor:pointer }
.palette .custom{ display:inline-flex; align-items:center; justify-content:center; background:conic-gradient(#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00) }
.palette .custom input{ opacity:0; width:22px; height:22px; cursor:pointer }
/* 触摸设备：扩大调色板点击区域和按钮 */
@media (hover: none) and (pointer: coarse) {
  .palette .dot{ width: 36px; height: 36px; }
  .palette .custom{ width: 36px; height: 36px; }
  .palette .custom input{ width: 36px; height: 36px; }
  .btn{ min-height: 44px; padding: 10px 14px; font-size: 14px; }
  .back, .done{ min-height: 44px; padding: 10px 14px; font-size: 14px; }
  .field input{ height: 44px; font-size: 16px; }
}
/* ===== 移动端响应式 ===== */
.search-row { position: relative; }
/* 有小组件时：小组件在左侧，搜索框缩短；上下留白规则见 SearchBar.vue 的 .search */
@media (min-width: 769px) {
  .search-row.with-widgets { display:flex; align-items:center; justify-content:center; gap:28px; width:min(1040px, 100%); margin:16px auto 40px }
  .search-row.with-widgets .search { flex:1 1 auto; width:auto; max-width:620px; margin:0 }
}
.mobile-group-btn, .mobile-group-mask, .mobile-group-list { display: none; }
@media (max-width: 768px) {
  .wrap{ padding: 12px 12px 100px 12px; }
  .btns-fixed{ bottom: calc(76px + var(--safe-b, 0px)); left: 8px; }
  .add-panel{ width: min(560px, 96vw); }
  .search-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px auto; width: 92vw; }
  /* 窄屏没有并排的空间：小组件放到搜索框上方一行 */
  .search-row .widgets { order: -1; width: 100%; justify-content: center }
  .mobile-group-btn { display: flex; align-items: center; gap: 4px; flex-shrink: 0; height: 44px; padding: 0 12px; border-radius: 22px; border: 1px solid var(--border); background: var(--glass); backdrop-filter: blur(4px); color: var(--text); cursor: pointer; box-shadow: var(--shadow-sm); white-space: nowrap; font-size: 13px }
  .mg-label { max-width: 64px; overflow: hidden; text-overflow: ellipsis }
  .mg-arrow { transition: transform .2s ease }
  .mg-arrow.flip { transform: rotate(180deg) }
  .mobile-group-mask { display: block; position: fixed; inset: 0; z-index: var(--z-mobile-mask) }
  .mobile-group-list { display: flex; flex-direction: column; gap: 2px; position: absolute; right: 0; top: 100%; margin-top: 8px; background: var(--glass); backdrop-filter: blur(8px); border: 1px solid var(--border); border-radius: 12px; padding: 6px; min-width: 140px; max-height: 60vh; overflow-y: auto; z-index: var(--z-mobile-list); box-shadow: var(--shadow) }
  .mg-item { display: flex; align-items: center; padding: 10px 12px; border-radius: 8px; border: 0; background: transparent; color: var(--text); cursor: pointer; font-size: 14px }
  .mg-item:active, .mg-item.on { background: color-mix(in srgb, var(--primary) 18%, transparent) }
}
</style>
