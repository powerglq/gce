<template>
  <teleport to="body">
    <div v-if="open" class="si-mask gce-panel-mask" @click="close"></div>
    <section
      v-if="open"
      ref="panelEl"
      class="si-panel gce-panel"
      :style="panelStyle"
      role="dialog"
      aria-modal="true"
      aria-label="收纳箱"
      @click.stop
    >
      <header class="si-hdr gce-panel-hdr gce-drag-handle" @pointerdown="onDragStart">
        <div class="hdr-left">
          <div class="ttl gce-panel-title">收纳箱</div>
          <span class="count gce-panel-sub">{{ store.count }} 条</span>
        </div>
        <div class="hdr-right gce-panel-actions">
          <button
            v-if="store.count > 0"
            class="clear-btn gce-btn gce-btn--sm gce-btn--ghost"
            type="button"
            title="清空收纳箱"
            @click="clearAll"
          >清空</button>
          <button
            class="gce-panel-close"
            type="button"
            aria-label="关闭"
            @click="close"
          >×</button>
        </div>
      </header>

      <div class="si-body">
        <div v-if="store.items.length === 0" class="empty">
          <div class="empty-icon">
            <svg
              viewBox="0 0 24 24"
              width="64"
              height="64"
              aria-hidden="true"
            >
              <path fill="currentColor" d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 16H5V5h14v14Z" opacity="0.3"/>
              <path fill="currentColor" d="M9 7h6v2H9V7Zm0 4h6v2H9v-2Zm0 4h4v2H9v-2Z" opacity="0.3"/>
            </svg>
          </div>
          <div class="empty-text">还没有收纳内容</div>
          <div class="empty-tip">在手机 Nav 中点「导出备份」，把文件传到电脑后导入</div>
          <div class="empty-hint">支持分享网页链接、公众号文章等</div>
        </div>
        <div v-else class="si-grid">
          <div
            v-for="item in store.sorted"
            :key="item.id"
            class="si-card"
            role="link"
            tabindex="0"
            :aria-label="item.title || item.url"
            @click="openItem(item)"
            @keydown.enter.prevent="openItem(item)"
            @keydown.space.prevent="openItem(item)"
          >
            <img
              v-if="item.thumbnail"
              :src="item.thumbnail"
              class="si-thumb"
              alt=""
              decoding="async"
              @error="onThumbError"
            />
            <div class="si-content">
              <div class="si-top">
                <span class="si-type" :class="item.contentType">{{ getTypeLabel(item.contentType, item.url) }}</span>
                <span class="si-time">{{ formatTime(item.createdAt) }}</span>
              </div>
              <div v-if="item.title" class="si-title">{{ item.title }}</div>
              <div class="si-url">{{ item.url }}</div>
            </div>
            <button
              class="si-del"
              type="button"
              :aria-label="`删除 ${item.title || item.url}`"
              @click.stop="removeItem(item.id)"
            >×</button>
          </div>
        </div>
      </div>
    </section>
  </teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useSharedItems, categorizeUrl } from '../../core/store/useSharedItems';
import { useSettings } from '../../core/store/useSettings';
import { useDraggablePanel } from '../../core/composables/useDraggablePanel';
import { confirm } from '../../core/utils/feedback';
import type { SharedItem } from '../../core/types/model';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const store = useSharedItems();
const settings = useSettings();

// 面板位置是设备级偏好，随设置保存
const panelEl = ref<HTMLElement | null>(null);
const panel = useDraggablePanel({
  elRef: panelEl,
  fallbackSize: { w: 780, h: 560 },
  savePos: (p) => void settings.patch({ sharedItemsPanelPos: p }),
});
const panelStyle = computed(() => panel.positionStyle.value);
const onDragStart = (e: PointerEvent) => panel.onDragStart(e);

watch(
  () => props.open,
  (v) => {
    if (v) panel.restoreFromStore(settings.settings.sharedItemsPanelPos, undefined);
  },
  { immediate: true }
);

function close() {
  emit('close');
}

function getTypeLabel(contentType: string, url: string): string {
  if (contentType === 'text') return '文字';
  if (contentType === 'wechat') return '公众号';
  return categorizeUrl(url);
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openItem(item: SharedItem) {
  if (item.contentType === 'text' || !/^https?:\/\//i.test(item.url)) return;
  window.open(item.url, '_blank', 'noopener');
}

function removeItem(id: number) {
  void store.removeItem(id);
}

async function clearAll() {
  const ok = await confirm({
    title: '清空收纳箱',
    message: `确定要清空全部 ${store.count} 条记录吗？此操作不可撤销。`,
    confirmText: '清空',
    variant: 'danger',
  });
  if (ok) await store.clearAll();
}

function onThumbError(e: Event) {
  (e.target as HTMLImageElement).style.display = 'none';
}
</script>

<style scoped>
.si-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-panel);
  background: var(--scrim-strong);
}
.hdr-left { display: flex; align-items: center; gap: 10px; }
.hdr-right { display: flex; align-items: center; gap: 6px; }
.clear-btn {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--danger) 25%, transparent);
  background: var(--danger-hover);
  color: var(--danger-text);
  cursor: pointer;
  transition: background 0.15s;
}
.clear-btn:hover { background: color-mix(in srgb, var(--danger) 25%, transparent); }
.si-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 0;
}
.empty-icon {
  margin-bottom: 16px;
  opacity: 0.4;
}
.empty-icon svg {
  display: block;
}
.empty-text {
  font-size: 16px;
  font-weight: 500;
  opacity: 0.7;
}
.empty-tip {
  font-size: 13px;
  margin-top: 8px;
  opacity: 0.5;
}
.empty-hint {
  font-size: 12px;
  margin-top: 4px;
  opacity: 0.4;
}

.si-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.si-card {
  display: flex;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  background: rgb(var(--ink) / 0.06);
  cursor: pointer;
  position: relative;
  transition: background 0.15s;
  min-width: 0;
}
.si-card:hover { background: rgb(var(--ink) / 0.1); }

.si-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.si-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.si-type {
  display: inline-block;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 500;
  flex-shrink: 0;
}
.si-type.url { background: color-mix(in srgb, #4285f4 15%, transparent); color: color-mix(in srgb, #4285f4 60%, var(--text)); }
.si-type.wechat { background: color-mix(in srgb, #07c160 15%, transparent); color: color-mix(in srgb, #07c160 60%, var(--text)); }
.si-type.text { background: color-mix(in srgb, #9c27b0 15%, transparent); color: color-mix(in srgb, #9c27b0 60%, var(--text)); }

.si-title {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.si-url {
  font-size: 10px;
  opacity: 0.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.si-time {
  font-size: 10px;
  opacity: 0.3;
  margin-left: auto;
  flex-shrink: 0;
}

.si-thumb {
  width: 40px;
  height: 40px;
  border-radius: 5px;
  object-fit: cover;
  flex-shrink: 0;
  align-self: center;
}

.si-del {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: none;
  background: none;
  font-size: 12px;
  opacity: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s;
  color: var(--text);
}
.si-card:hover .si-del { opacity: 0.5; }
.si-del:hover { opacity: 1 !important; background: var(--danger-hover); color: var(--danger-text); }

</style>
