<template>
  <teleport to="body">
    <div v-if="open" class="nb-mask gce-panel-mask" @click="close"></div>
    <section
      v-if="open"
      ref="panelEl"
      class="nb-panel gce-panel"
      :style="panelStyle"
      role="dialog"
      aria-modal="true"
      aria-label="记事本"
      @click.stop
    >
      <header class="nb-hdr gce-panel-hdr gce-drag-handle" @pointerdown="onDragStart">
        <div class="hdr-left">
          <div class="ttl gce-panel-title">记事本</div>
          <span
            class="st"
            :class="notebook.saving ? 'saving' : 'saved'"
            :title="notebook.saving ? '保存中' : '已保存'"
            aria-live="polite"
          ></span>
        </div>
        <button
          class="gce-panel-close"
          type="button"
          aria-label="关闭"
          @click="close"
        >×</button>
      </header>

      <div class="nb-body">
        <!-- 左侧：条目列表 -->
        <aside class="nb-sidebar">
          <button class="nb-add-btn" type="button" @click="addEntry">+ 新建</button>
          <div
            ref="listEl"
            class="nb-list"
            role="listbox"
            aria-label="笔记列表"
          >
            <div
              v-for="entry in notebook.entries"
              :key="entry.id"
              class="nb-item"
              :class="{ active: entry.id === notebook.currentId }"
              role="option"
              tabindex="0"
              :aria-selected="entry.id === notebook.currentId"
              @click="selectEntry(entry.id)"
              @dblclick="startRename(entry.id)"
              @keydown.enter.prevent="selectEntry(entry.id)"
            >
              <span class="nb-item-drag" title="拖拽排序">⠿</span>
              <div class="nb-item-body">
                <template v-if="renamingId === entry.id">
                  <input
                    ref="renameInputEl"
                    class="nb-rename-input"
                    :value="entry.name"
                    maxlength="40"
                    @blur="finishRename(entry.id, $event)"
                    @keydown.enter="finishRename(entry.id, $event)"
                    @keydown.escape="cancelRename"
                    @click.stop
                  />
                </template>
                <template v-else>
                  <div class="nb-item-name">{{ entry.name }}</div>
                </template>
              </div>
              <button
                class="nb-item-del"
                type="button"
                title="删除"
                @click.stop="removeEntry(entry.id)"
              >×</button>
            </div>
          </div>
        </aside>

        <!-- 右侧：内容编辑 -->
        <div class="nb-main">
          <div class="nb-toolbar" role="toolbar" aria-label="文字格式">
            <button
              type="button"
              class="tb-btn"
              title="减小字号"
              aria-label="减小字号"
              :disabled="fontSize <= NOTE_FONT_SIZE.min"
              @click="changeFontSize(-1)"
            >A-</button>
            <span class="tb-size" aria-live="polite">{{ fontSize }}px</span>
            <button
              type="button"
              class="tb-btn"
              title="增大字号"
              aria-label="增大字号"
              :disabled="fontSize >= NOTE_FONT_SIZE.max"
              @click="changeFontSize(1)"
            >A+</button>
            <select
              class="tb-font"
              aria-label="字体"
              :value="settings.settings.notebookFontFamily"
              @change="setFont(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="f in FONTS" :key="f.key" :value="f.key">{{ f.label }}</option>
            </select>
          </div>
          <textarea
            ref="ta"
            class="nb-ta"
            :style="taStyle"
            :value="currentText"
            :placeholder="currentEntry ? '随手记点东西…（自动保存）' : '请先创建或选择一条笔记'"
            :disabled="!currentEntry"
            @input="onInput"
            @paste="onPaste"
            @drop.prevent="onDrop"
            @dragover.prevent
          ></textarea>

          <div v-if="currentImages.length" class="att">
            <div class="att-hdr">
              <div class="att-ttl">附件</div>
              <div class="att-tip">支持粘贴/拖拽图片</div>
            </div>
            <div class="att-list">
              <div
                v-for="img in currentImages"
                :key="img.id"
                class="att-item"
                role="button"
                tabindex="0"
                :aria-label="`预览图片 ${img.name || ''}`"
                @click="openPreview(img.id, img.name)"
                @keydown.enter.prevent="openPreview(img.id, img.name)"
              >
                <img class="att-img" :src="imgUrls[img.id] || ''" :alt="img.name || '图片'" />
                <button
                  type="button"
                  class="att-del"
                  aria-label="删除图片"
                  @click.stop="removeImg(img.id)"
                >×</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer class="nb-ftr">
        <div class="hint">自动保存 · 支持粘贴 / 拖入图片</div>
        <button class="btn" type="button" @click="close">完成</button>
      </footer>
      <div class="nb-resize" @pointerdown="panel.onResizeStart($event)"></div>
    </section>

    <!-- 图片预览 -->
    <div
      v-if="previewUrl"
      class="pv"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      @click="closePreview"
    >
      <div class="pv-inner" @click.stop>
        <div class="pv-top">
          <div class="pv-title">{{ previewName || '图片' }}</div>
          <button
            class="pv-x"
            type="button"
            aria-label="关闭预览"
            @click="closePreview"
          >×</button>
        </div>
        <div
          class="pv-body"
          @wheel.prevent="onPreviewWheel"
          @pointerdown="onPreviewDragStart"
          @pointermove="onPreviewDragMove"
          @pointerup="onPreviewDragEnd"
          @pointercancel="onPreviewDragEnd"
          @touchstart.passive="onPreviewTouchStart"
          @touchmove="onPreviewTouchMove"
          @touchend="onPreviewTouchEnd"
          @touchcancel="onPreviewTouchEnd"
        >
          <img
            class="pv-img"
            :class="pvDragging ? 'dragging' : ''"
            :src="previewUrl"
            :alt="previewName || '图片'"
            :style="{ transform: `translate(${pvTx}px, ${pvTy}px) scale(${pvScale})` }"
            draggable="false"
            @dragstart.prevent
            @mousedown.prevent
          />
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import Sortable from 'sortablejs';
import { useNotebook } from '../../core/store/useNotebook';
import { useSettings } from '../../core/store/useSettings';
import { getNotebookImageBlob } from '../../core/utils/imageAttachmentRepo';
import { useDraggablePanel } from '../../core/composables/useDraggablePanel';
import { revertSortableMove } from '../../core/utils/dragState';
import { confirm } from '../../core/utils/feedback';
import { NOTE_FONT_SIZE } from '../../../shared/model.js';
import type { Settings } from '../../core/types/model';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const notebook = useNotebook();
const settings = useSettings();
const ta = ref<HTMLTextAreaElement | null>(null);
const listEl = ref<HTMLElement | null>(null);

// ========== 字号 / 字体 ==========

const FONTS: Array<{ key: Settings['notebookFontFamily']; label: string; stack: string }> = [
  { key: 'system', label: '系统默认', stack: 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif' },
  { key: 'hei', label: '黑体', stack: '"Microsoft YaHei", "PingFang SC", "Heiti SC", "Noto Sans CJK SC", sans-serif' },
  { key: 'song', label: '宋体', stack: '"SimSun", "Songti SC", "Noto Serif CJK SC", serif' },
  { key: 'kai', label: '楷体', stack: '"KaiTi", "STKaiti", "Kaiti SC", serif' },
  { key: 'mono', label: '等宽', stack: 'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace' },
];

const fontSize = computed(() => settings.settings.notebookFontSize);
const taStyle = computed(() => ({
  fontSize: `${fontSize.value}px`,
  fontFamily: (FONTS.find((f) => f.key === settings.settings.notebookFontFamily) ?? FONTS[0]).stack,
}));

function changeFontSize(delta: number) {
  const next = Math.min(NOTE_FONT_SIZE.max, Math.max(NOTE_FONT_SIZE.min, fontSize.value + delta));
  if (next !== fontSize.value) void settings.patch({ notebookFontSize: next }, 300);
}

function setFont(key: string) {
  void settings.patch({ notebookFontFamily: key as Settings['notebookFontFamily'] });
}

// ========== 面板位置与尺寸（位置随条目保存，尺寸是设备级偏好） ==========

const panelEl = ref<HTMLElement | null>(null);
const panel = useDraggablePanel({
  elRef: panelEl,
  resizable: true,
  minSize: { w: 320, h: 240 },
  fallbackSize: { w: 780, h: 560 },
  savePos: (p) => notebook.setPanelPos(p.left, p.top),
  saveSize: (sz) => void settings.patch({ notebookPanelSize: { w: Math.round(sz.w), h: Math.round(sz.h) } }),
});

const panelStyle = computed(() => {
  const s: Record<string, string> = { ...panel.positionStyle.value };
  // 调整过尺寸后保留一道视口上限，避免大屏调好的尺寸在小屏上溢出
  if (panel.size.value) s.maxHeight = `min(${panel.size.value.h}px, calc(100vh - 32px))`;
  return s;
});
const onDragStart = (e: PointerEvent) => panel.onDragStart(e);

// ========== 当前条目 ==========

const currentEntry = computed(() => notebook.current);
const currentText = computed(() => notebook.currentContent);
const currentImages = computed(() => notebook.currentImages);

// ========== 条目列表拖拽排序 ==========

let sortable: Sortable | null = null;

function initSortable() {
  if (!listEl.value || sortable) return;
  sortable = Sortable.create(listEl.value, {
    animation: 120,
    ghostClass: 'nb-item-ghost',
    handle: '.nb-item-drag',
    onUpdate(evt) {
      const from = evt.oldIndex;
      const to = evt.newIndex;
      revertSortableMove(evt);
      if (from !== undefined && to !== undefined) void notebook.reorder(from, to);
    },
  });
}

function destroySortable() {
  sortable?.destroy();
  sortable = null;
}

// ========== 条目 CRUD ==========

async function addEntry() {
  if (await notebook.addEntry()) void nextTick(() => ta.value?.focus());
}

function selectEntry(id: string) {
  void notebook.setCurrent(id);
}

async function removeEntry(id: string) {
  const entry = notebook.entries.find((e) => e.id === id);
  if (!entry) return;
  const ok = await confirm({
    title: '删除笔记',
    message: `确定要删除「${entry.name}」吗？此操作不可撤销。`,
    confirmText: '删除',
    variant: 'danger',
  });
  if (ok) await notebook.removeEntry(id);
}

// ========== 重命名 ==========

const renamingId = ref('');
const renameInputEl = ref<HTMLInputElement[] | null>(null);

function startRename(id: string) {
  renamingId.value = id;
  void nextTick(() => {
    const input = renameInputEl.value?.[0];
    input?.focus();
    input?.select();
  });
}

function finishRename(id: string, e: Event) {
  if (renamingId.value !== id) return; // Enter 与随后的 blur 只处理一次
  renamingId.value = '';
  const val = (e.target as HTMLInputElement).value.trim();
  if (val && val !== notebook.entries.find((x) => x.id === id)?.name) void notebook.renameEntry(id, val);
}

function cancelRename() {
  renamingId.value = '';
}

// ========== 内容输入 / 图片 ==========

function onInput(e: Event) {
  notebook.setContent((e.target as HTMLTextAreaElement).value);
}

async function onPaste(e: ClipboardEvent) {
  const blobs = Array.from(e.clipboardData?.items || [])
    .filter((it) => it.type.toLowerCase().startsWith('image/'))
    .map((it) => it.getAsFile())
    .filter((f): f is File => !!f)
    .map((f) => ({ blob: f as Blob, name: f.name }));
  if (!blobs.length) return;
  e.preventDefault();
  await notebook.addImagesFromBlobs(blobs);
}

async function onDrop(e: DragEvent) {
  const imgs = Array.from(e.dataTransfer?.files || [])
    .filter((f) => f.type.toLowerCase().startsWith('image/'))
    .map((f) => ({ blob: f as Blob, name: f.name }));
  if (imgs.length) await notebook.addImagesFromBlobs(imgs);
}

async function removeImg(id: string) {
  const ok = await confirm({
    title: '删除图片',
    message: '确定要删除这张图片吗？此操作不可撤销。',
    confirmText: '删除',
    variant: 'danger',
  });
  if (ok) await notebook.removeImage(id);
}

// ========== 图片加载（IndexedDB → objectURL） ==========

const imgUrls = reactive<Record<string, string>>({});

function revokeUrl(id: string) {
  if (!imgUrls[id]) return;
  URL.revokeObjectURL(imgUrls[id]);
  delete imgUrls[id];
}

function revokeAll() {
  for (const k of Object.keys(imgUrls)) revokeUrl(k);
}

async function syncImages() {
  if (!props.open) return;
  const ids = new Set(currentImages.value.map((x) => x.id));
  for (const k of Object.keys(imgUrls)) if (!ids.has(k)) revokeUrl(k);
  for (const id of ids) {
    if (imgUrls[id]) continue;
    try {
      const blob = await getNotebookImageBlob(id);
      if (blob && !imgUrls[id]) imgUrls[id] = URL.createObjectURL(blob);
    } catch {
      /* 单张失败不影响其它图片 */
    }
  }
}

watch(() => currentImages.value.map((x) => x.id).join(','), () => void syncImages());

// ========== 图片预览（滚轮 / 双指缩放，拖动平移） ==========

const previewUrl = ref('');
const previewName = ref('');
const pvScale = ref(1);
const pvTx = ref(0);
const pvTy = ref(0);
const pvDragging = ref(false);
let pvDragBase: { x: number; y: number; tx: number; ty: number } | null = null;
let pinch = { dist: 0, scale: 1, x: 0, y: 0 };

function resetPreviewTransform() {
  pvScale.value = 1;
  pvTx.value = 0;
  pvTy.value = 0;
}

async function openPreview(id: string, name?: string) {
  const blob = await getNotebookImageBlob(id).catch(() => null);
  if (!blob) return;
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = URL.createObjectURL(blob);
  previewName.value = name || '';
  resetPreviewTransform();
}

function closePreview() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = '';
  previewName.value = '';
  resetPreviewTransform();
}

/** 以 (mx, my) 为锚点缩放到 next */
function zoomAt(mx: number, my: number, next: number) {
  const s = Math.max(0.2, Math.min(6, next));
  const wx = (mx - pvTx.value) / pvScale.value;
  const wy = (my - pvTy.value) / pvScale.value;
  pvScale.value = s;
  pvTx.value = mx - wx * s;
  pvTy.value = my - wy * s;
}

function onPreviewWheel(e: WheelEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  zoomAt(e.clientX - rect.left, e.clientY - rect.top, pvScale.value * (e.deltaY > 0 ? 0.92 : 1.08));
}

function onPreviewDragStart(e: PointerEvent) {
  if (e.button !== 0 || e.pointerType === 'touch') return;
  e.preventDefault();
  pvDragging.value = true;
  pvDragBase = { x: e.clientX, y: e.clientY, tx: pvTx.value, ty: pvTy.value };
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
}

function onPreviewDragMove(e: PointerEvent) {
  if (!pvDragging.value || !pvDragBase) return;
  pvTx.value = pvDragBase.tx + (e.clientX - pvDragBase.x);
  pvTy.value = pvDragBase.ty + (e.clientY - pvDragBase.y);
}

function onPreviewDragEnd() {
  pvDragging.value = false;
  pvDragBase = null;
}

const touchDist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

function onPreviewTouchStart(e: TouchEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  if (e.touches.length === 2) {
    const [a, b] = [e.touches[0], e.touches[1]];
    pinch = {
      dist: touchDist(a, b),
      scale: pvScale.value,
      x: (a.clientX + b.clientX) / 2 - rect.left,
      y: (a.clientY + b.clientY) / 2 - rect.top,
    };
  } else if (e.touches.length === 1) {
    pvDragging.value = true;
    pvDragBase = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: pvTx.value, ty: pvTy.value };
  }
}

function onPreviewTouchMove(e: TouchEvent) {
  if (e.touches.length === 2 && pinch.dist > 0) {
    e.preventDefault();
    zoomAt(pinch.x, pinch.y, pinch.scale * (touchDist(e.touches[0], e.touches[1]) / pinch.dist));
  } else if (e.touches.length === 1 && pvDragBase) {
    pvTx.value = pvDragBase.tx + (e.touches[0].clientX - pvDragBase.x);
    pvTy.value = pvDragBase.ty + (e.touches[0].clientY - pvDragBase.y);
  }
}

function onPreviewTouchEnd(e: TouchEvent) {
  if (e.touches.length < 2) pinch.dist = 0;
  if (e.touches.length === 0) onPreviewDragEnd();
}

// ========== 打开 / 关闭 ==========

async function close() {
  await notebook.flush();
  emit('close');
}

watch(
  () => props.open,
  async (v) => {
    if (!v) {
      closePreview();
      revokeAll();
      destroySortable();
      return;
    }
    await nextTick();
    initSortable();
    void syncImages();
    const sz = settings.settings.notebookPanelSize;
    panel.restoreFromStore(notebook.current?.panelPos, sz ? { w: sz.w, h: sz.h } : undefined);
    await nextTick();
    ta.value?.focus();
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  closePreview();
  revokeAll();
  destroySortable();
});
</script>

<style scoped>
/* ========== 遮罩与面板 ========== */
.nb-mask{
  position: fixed; inset:0;
  background: var(--scrim-strong);
  z-index: var(--z-panel);
}

/* ========== 头部 ========== */

.hdr-left{ display:flex; align-items:center; gap: 10px; min-width: 0; }
.ttl{ font-weight: 700; letter-spacing: .5px; font-size: 14px; }
.st{
  width: 10px; height: 10px; border-radius: 999px;
  background: var(--status-ok);
  box-shadow: 0 0 0 4px rgb(var(--ink) / .06);
  border: 1px solid color-mix(in srgb, var(--status-ok) 22%, transparent);
}
.st.saving{ background: var(--status-busy); border-color: color-mix(in srgb, var(--status-busy) 26%, transparent); animation: pulse 1.05s ease-in-out infinite; }
.st.saved{ background: var(--status-ok); border-color: color-mix(in srgb, var(--status-ok) 22%, transparent); }
@keyframes pulse{ 0%,100%{ transform: scale(1); opacity:.85 } 50%{ transform: scale(1.35); opacity:1 } }

/* 关闭按钮样式完全交给 UI Kit（.gce-panel-close），
   这里不再保留任何私有覆盖，避免三个面板出现差异。 */

/* ========== 主体：左列表 + 右内容 ========== */
.nb-body{
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

/* --- 左侧列表 --- */
.nb-sidebar{
  width: 180px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgb(var(--ink) / .08);
  overflow: hidden;
}
.nb-add-btn{
  margin: 8px 8px 0;
  padding: 6px 0;
  border-radius: 8px;
  border: 1px dashed rgb(var(--ink) / .18);
  background: transparent;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background .15s;
}
.nb-add-btn:hover{ background: rgb(var(--ink) / .08); }
.nb-list{
  flex: 1;
  overflow-y: auto;
  padding: 4px 4px 8px;
}
.nb-item{
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 7px 6px 7px 4px;
  border-radius: 8px;
  cursor: pointer;
  transition: background .12s;
  user-select: none;
}
.nb-item:hover{ background: rgb(var(--ink) / .07); }
.nb-item.active{ background: rgb(var(--ink) / .13); }
.nb-item-ghost{ opacity: .4; }
.nb-item-drag{
  flex-shrink: 0;
  width: 18px; height: 18px;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px;
  opacity: .35;
  cursor: grab;
  border-radius: 4px;
}
.nb-item-drag:hover{ opacity: .7; background: var(--overlay-hover); }
.nb-item-body{ flex:1; min-width: 0; }
.nb-item-name{
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nb-rename-input{
  width: 100%;
  font-size: 13px;
  padding: 1px 4px;
  border-radius: 4px;
  border: 1px solid rgb(var(--ink) / .25);
  background: var(--field);
  color: var(--text);
  outline: none;
}
.nb-item-del{
  flex-shrink: 0;
  width: 20px; height: 20px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  opacity: 0;
  transition: opacity .12s;
}
.nb-item:hover .nb-item-del{ opacity: .5; }
.nb-item-del:hover{ opacity: 1 !important; background: var(--danger-hover); color: var(--danger-text); }

/* --- 右侧内容 --- */
.nb-main{
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.nb-ta{
  flex:1;
  width: 100%;
  padding: 12px;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--text);
  font-size: 14px;
  line-height: 1.6;
}
.nb-ta:disabled{ opacity: .5; }

/* ========== 附件 ========== */
.att{
  border-top: 1px solid rgb(var(--ink) / .08);
  padding: 8px 12px;
  display:flex; flex-direction: column; gap: 8px;
}
.att-hdr{ display:flex; align-items:baseline; justify-content: space-between; gap: 12px; }
.att-ttl{ font-weight: 700; font-size: 12px; letter-spacing: .3px; opacity: .9; }
.att-tip{ font-size: 12px; opacity: .72; }
.att-list{ display:flex; flex-wrap: wrap; gap: 8px; }
.att-item{ position: relative; width: 64px; height: 64px; border-radius: 12px; overflow:hidden; border: 1px solid rgb(var(--ink) / .12); background: rgb(var(--ink) / .06); }
.att-img{ width: 100%; height: 100%; object-fit: cover; display:block; }
.att-del{ position:absolute; right:4px; top:4px; width: 20px; height: 20px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.25); color: #fff; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size: 12px; }
.att-del:hover{ background: rgba(0,0,0,.36); }

/* ========== 底部 ========== */
.nb-ftr{
  display:flex; align-items:center; justify-content: space-between;
  padding: 8px 32px 8px 12px;
  border-top: 1px solid rgb(var(--ink) / .08);
  flex-shrink: 0;
}
.hint{ font-size: 12px; opacity: .75; }
.btn{
  padding: 6px 12px; border-radius: 8px;
  border: 1px solid rgb(var(--ink) / .14);
  background: rgb(var(--ink) / .08);
  color: var(--text); cursor:pointer; font-size: 13px;
}
.btn:hover{ background: rgb(var(--ink) / .12); }

/* ========== resize 手柄 ========== */
.nb-resize { position: absolute; right: 0; bottom: 0; width: 24px; height: 24px; cursor: nwse-resize; z-index: var(--z-base) }
.nb-resize::after { content: ''; position: absolute; right: 5px; bottom: 5px; width: 10px; height: 10px; border-right: 2px solid rgb(var(--ink) / .3); border-bottom: 2px solid rgb(var(--ink) / .3); pointer-events: none }

/* ========== 图片预览（固定深色看图背景，两种主题一致，文字也固定为白色） ========== */
.pv{ position: fixed; inset: 0; z-index: var(--z-panel-preview); background: rgba(0,0,0,.58); display:flex; align-items:center; justify-content:center; padding: 18px; }
.pv-inner{ width: min(980px, calc(100vw - 36px)); height: min(720px, calc(100vh - 36px)); border-radius: 16px; border: 1px solid rgba(255,255,255,.14); background: rgba(18,20,22,.78); color: #fff; box-shadow: 0 18px 60px rgba(0,0,0,.45); backdrop-filter: blur(10px); display:flex; flex-direction: column; overflow:hidden; }
.pv-top{ height: 44px; padding: 0 12px 0 16px; display:flex; align-items:center; justify-content: space-between; gap: 12px; border-bottom: 1px solid rgba(255,255,255,.10); }
.pv-title{ font-weight: 700; font-size: 13px; opacity: .92; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pv-x{ width: 28px; height: 28px; border-radius: 8px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06); color: rgba(255,255,255,.92); cursor:pointer; }
.pv-x:hover{ background: rgba(255,255,255,.10); }
.pv-body{ flex:1; display:flex; align-items:center; justify-content:center; padding: 12px; overflow: hidden; touch-action: pan-x pan-y; }
.pv-img{ max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 12px; cursor: grab; user-select: none; -webkit-user-drag: none; will-change: transform; transform-origin: 0 0; }
.pv-img.dragging{ cursor: grabbing; }

/* ========== 触摸设备：扩大触摸目标 ========== */
@media (hover: none) and (pointer: coarse) {
  .pv-x { width: 44px; height: 44px; font-size: 16px; }
  .att-del { width: 36px; height: 36px; font-size: 14px; right: 4px; top: 4px; }
  .nb-item-del { width: 36px; height: 36px; opacity: .5; }
  .nb-item:hover .nb-item-del { opacity: .5; }
  .btn { padding: 10px 16px; min-height: 44px; }
}

/* ========== 移动端响应式 ========== */
@media (max-width: 640px) {
  .nb-sidebar { width: 120px }
  .nb-resize { display: none }
  .nb-ta { font-size: 15px; padding: 10px; }
}
@media (max-width: 380px) {
  .nb-sidebar { display: none; }
}

/* ===== 窄屏：记事本采用更紧凑的框体（与设置/收纳箱的差异是刻意保留的设计决定） ===== */
@media (max-width: 768px) {
  .nb-panel { width: min(420px, calc(100vw - 24px)); max-height: min(480px, calc(100vh - 60px)) }
}
@media (max-width: 380px) {
  .nb-panel { width: calc(100vw - 16px); max-height: calc(100vh - 48px) }
}
</style>
<style scoped>
/* ========== 文字格式工具栏 ========== */
.nb-toolbar{
  display:flex; align-items:center; gap:6px;
  padding:6px 12px;
  border-bottom:1px solid rgb(var(--ink) / .08);
  flex-shrink:0;
}
.tb-btn{
  min-width:34px; height:26px; padding:0 8px;
  border-radius:6px; border:1px solid rgb(var(--ink) / .14);
  background:rgb(var(--ink) / .06); color:var(--text);
  font-size:12px; font-weight:600; cursor:pointer;
}
.tb-btn:hover:not(:disabled){ background:rgb(var(--ink) / .12); }
.tb-btn:disabled{ opacity:.4; cursor:not-allowed; }
.tb-size{ min-width:38px; text-align:center; font-size:12px; opacity:.8; font-variant-numeric:tabular-nums; }
.tb-font{
  height:26px; margin-left:6px; padding:0 6px;
  border-radius:6px; border:1px solid rgb(var(--ink) / .14);
  background:var(--field); color:var(--text); font-size:12px; outline:none;
}
.tb-font:focus{ border-color:var(--primary); }
.tb-font option{ background:var(--surface-solid); color:var(--text); }
</style>