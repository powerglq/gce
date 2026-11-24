<template>
  <aside
    class="group-sidebar"
    :class="{ interactive: showAdd, 'names-hover': settings.settings.groupNameMode === 'hover' }"
  >
    <ul ref="listEl" class="groups">
      <!-- 选中高亮：一个滑块在分组间移动，而不是逐个按钮切换描边 -->
      <li
        v-show="indicator"
        class="indicator"
        :class="{ animate: indicatorAnimate }"
        :style="indicatorStyle"
        aria-hidden="true"
      ></li>
      <li v-for="g in bm.groupsSorted" :key="g.id" class="group-row">
        <button
          type="button"
          class="item glass"
          :class="{ on: g.id === modelValue, over: overId === g.id }"
          :title="g.name"
          @click="emit('update:modelValue', g.id)"
          @contextmenu.prevent="menuFor = menuFor === g.id ? '' : g.id"
          @dragenter.prevent="overId = g.id"
          @dragover.prevent="overId = g.id"
          @dragleave="overId === g.id && (overId = '')"
          @drop.prevent="onDrop(g.id)"
        >
          <span class="ico"><GroupIcon :name="g.icon" /></span>
          <span v-if="updatingGroup === g.id" class="name left busy" aria-live="polite">{{ g.name }} · 更新图标 {{ progressText }}</span>
          <span v-else class="name left">{{ g.name }}</span>
        </button>

        <div v-if="menuFor === g.id" class="menu" @click.stop>
          <button @click="openEdit(g)">编辑</button>
          <button :disabled="!!updatingGroup" @click="refreshIcons(g)">更新图标</button>
          <button class="danger" @click="doRemove(g.id)">删除</button>
        </div>
      </li>
    </ul>
    <div class="ops">
      <button
        type="button"
        class="add glass"
        title="添加分类"
        style="font-size: 26px;"
        @click="openAdd"
      >+</button>
    </div>

    <div v-if="showAdd" class="popover-mask" @click="closePopover"></div>
    <div
      v-if="showAdd"
      class="popover glass"
      style="z-index: var(--z-sidebar-pop);"
      @click.stop
    >
      <input
        ref="nameInput"
        v-model="newName"
        class="gname"
        placeholder="分类名称"
        maxlength="20"
        @keydown.enter.prevent="confirmAdd"
        @keydown.esc="closePopover"
      />
      <div class="icon-picker">
        <section v-for="cat in GROUP_ICON_CATEGORIES" :key="cat.name" class="icon-cat">
          <div class="icon-cat-name">{{ cat.name }}</div>
          <div class="icon-grid">
            <button
              v-for="it in cat.icons"
              :key="it.key"
              type="button"
              class="icon-btn"
              :class="{ on: it.key === selectedIcon }"
              :title="it.label"
              :aria-label="it.label"
              :aria-pressed="it.key === selectedIcon"
              @click="selectedIcon = it.key"
            >
              <GroupIcon :name="it.key" />
            </button>
          </div>
        </section>
      </div>
      <button class="confirm" @click="confirmAdd">{{ editingId ? '保存' : '添加分类' }}</button>
    </div>
  </aside>
</template>
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useBookmarks } from '../../core/store/useBookmarks';
import { useSettings } from '../../core/store/useSettings';
import { notifyError } from '../../core/store/useStorage';
import { dragging } from '../../core/utils/dragState';
import { createResourceManager } from '../../core/utils/lifecycle';
import { toast, confirm } from '../../core/utils/feedback';
import type { Group } from '../../core/types/model';
import GroupIcon from './GroupIcon.vue';
import { DEFAULT_GROUP_ICON, GROUP_ICON_CATEGORIES, resolveGroupIcon } from '../../core/groupIcons';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();
const bm = useBookmarks();
const settings = useSettings();
const rm = createResourceManager();

const showAdd = ref(false);
const editingId = ref('');
const newName = ref('');
const selectedIcon = ref(DEFAULT_GROUP_ICON);
const menuFor = ref('');
const overId = ref('');
const nameInput = ref<HTMLInputElement | null>(null);

// ============ 选中滑块 ============

const listEl = ref<HTMLElement | null>(null);
/** 滑块的位置与尺寸（相对列表）；null 表示没有选中项 */
const indicator = ref<{ x: number; y: number; w: number; h: number } | null>(null);
/** 首次定位与分组增删时直接就位，只有切换选中时才做滑动动画 */
const indicatorAnimate = ref(false);
const indicatorStyle = computed(() => {
  const r = indicator.value;
  return r ? { width: `${r.w}px`, height: `${r.h}px`, transform: `translate(${r.x}px, ${r.y}px)` } : {};
});

/** 位置与尺寸都取选中按钮的实测值，与按钮完全重合，不依赖 CSS 里写死的数值 */
function syncIndicator(animate: boolean) {
  void nextTick(() => {
    const list = listEl.value;
    const btn = list?.querySelector<HTMLElement>('.item.on');
    indicatorAnimate.value = animate && indicator.value !== null;
    if (!list || !btn) {
      indicator.value = null;
      return;
    }
    const a = list.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    indicator.value = { x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height };
  });
}

watch(() => props.modelValue, () => syncIndicator(true));
watch(() => bm.groupsSorted.map((g) => g.id).join(','), () => syncIndicator(false));
onMounted(() => syncIndicator(false));

rm.onDocument('click', (e) => {
  if (menuFor.value && !(e.target as Element)?.closest?.('.group-sidebar .menu')) menuFor.value = '';
});

function showPopover() {
  showAdd.value = true;
  void nextTick(() => nameInput.value?.focus());
}
function openAdd() {
  editingId.value = '';
  newName.value = '';
  selectedIcon.value = DEFAULT_GROUP_ICON;
  showPopover();
}
function openEdit(g: Group) {
  menuFor.value = '';
  editingId.value = g.id;
  newName.value = g.name;
  selectedIcon.value = resolveGroupIcon(g.icon);
  showPopover();
}
function closePopover() {
  showAdd.value = false;
  editingId.value = '';
  newName.value = '';
}

async function confirmAdd() {
  const name = newName.value.trim();
  if (!name) {
    toast('请输入分类名称');
    return;
  }
  try {
    if (editingId.value) {
      await bm.updateGroup(editingId.value, { name, icon: selectedIcon.value });
    } else {
      const id = await bm.addGroup(name, selectedIcon.value);
      emit('update:modelValue', id);
    }
    closePopover();
  } catch (err) {
    notifyError(err);
  }
}

async function onDrop(targetGroupId: string) {
  overId.value = '';
  const drag = dragging.value;
  if (!drag) return;
  const b = bm.bookmarks.find((x) => x.id === drag.id);
  if (!b) return;
  const target = bm.groups.find((g) => g.id === targetGroupId);
  if (b.groupId === targetGroupId) {
    toast(`「${b.title}」已经在该分组中`);
    return;
  }
  try {
    await bm.moveToGroup(b.id, targetGroupId);
    // 从 Dock 拖到分组：视为「移回分组」，取消固定
    if (drag.source === 'dock') await settings.unpinDock(b.id);
    toast(`已将「${b.title}」移动到「${target?.name ?? '分组'}」`, { type: 'success' });
  } catch (err) {
    notifyError(err);
  }
}

/** 正在批量更新图标的分类 id（同一时间只允许一个） */
const updatingGroup = ref('');
const progressText = ref('');
async function refreshIcons(g: Group) {
  menuFor.value = '';
  if (updatingGroup.value) return;
  const total = bm.byGroup.get(g.id)?.length ?? 0;
  if (!total) {
    toast('该分类下没有链接');
    return;
  }
  updatingGroup.value = g.id;
  progressText.value = `0/${total}`;
  // 切到该分类，图标获取到一个显示一个
  emit('update:modelValue', g.id);
  try {
    const { updated } = await bm.refreshGroupIcons(g.id, (done, all) => {
      progressText.value = `${done}/${all}`;
    });
    toast(
      updated === total ? `已更新 ${updated} 个图标` : `已更新 ${updated} / ${total} 个图标，其余未获取到`,
      { type: updated ? 'success' : 'warning' }
    );
  } catch (err) {
    notifyError(err, '更新图标失败');
  } finally {
    updatingGroup.value = '';
  }
}

async function doRemove(id: string) {
  menuFor.value = '';
  const count = bm.byGroup.get(id)?.length ?? 0;
  const ok = await confirm({
    title: '删除分类',
    message: count ? `该分类下有 ${count} 条链接，确定要删除分类及其中所有链接吗？` : '确定删除该分类？',
    confirmText: count ? '全部删除' : '删除',
    variant: 'danger',
  });
  if (!ok) return;
  try {
    await bm.removeGroup(id, true);
    if (count) toast('已删除分类及其中的链接', { type: 'success' });
  } catch (err) {
    notifyError(err);
  }
}
</script>
<style scoped>
.group-sidebar{ position:fixed; right:calc(12px + var(--safe-r, 0px)); top:var(--safe-t, 0px); bottom:var(--safe-b, 0px); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; padding:8px 4px; z-index:var(--z-sidebar); pointer-events:auto }
.groups{ position:relative; list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:4px }
.indicator{ position:absolute; left:0; top:0; box-sizing:border-box; border-radius:10px; pointer-events:none; z-index:1; border:2px solid var(--primary); background: color-mix(in srgb, var(--primary) 18%, transparent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 14%, transparent), 0 6px 18px color-mix(in srgb, var(--primary) 24%, transparent) }
.indicator.animate{ transition: transform .42s cubic-bezier(.16,1,.3,1) }
.group-row{ position:relative; display:flex; align-items:center; pointer-events:auto }
.item{ width:40px; height:40px; border-radius:10px; border:1px solid var(--border); background: var(--surface); backdrop-filter: blur(4px); color:var(--text); cursor:pointer; display:flex; align-items:center; justify-content:center; position:relative; pointer-events:auto; transition: box-shadow var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out) }
.item:hover{ box-shadow: var(--shadow) }
.item.over{ outline:2px dashed var(--primary) }
.item .name{ position:absolute; background:rgba(0,0,0,.6); backdrop-filter: blur(2px); color:#fff; padding:4px 8px; border-radius:10px; font-size:12px; opacity:1; pointer-events:none; white-space:nowrap; border:1px solid rgba(255,255,255,.12); transition: opacity var(--dur-fast) var(--ease-out) }
.item .name.left{ left:-8px; transform: translateX(-100%); }

/* 设置「分类名称：悬停显示」 */
.names-hover .item .name{ opacity:0 }
.names-hover .group-row:hover .item .name,
.names-hover .item:focus-visible .name{ opacity:1 }
.item.on{ color:var(--text-strong) }
.item:focus-visible{ outline:2px solid var(--primary); outline-offset:2px }

.ico{ display:flex; align-items:center; justify-content:center; width:18px; height:18px; font-size:18px }
.menu{ position:absolute; right:49px; top:50%; transform: translateY(-50%); background:var(--overlay); border:1px solid var(--border); border-radius:10px; padding:6px; box-shadow: var(--shadow); display:flex; flex-direction:column; gap:6px; z-index: var(--z-sidebar-menu); min-width:140px }
.menu button{ background:transparent; border:0; color:var(--text); padding:6px 10px; text-align:left; border-radius:8px; cursor:pointer }
.menu button:hover{ background: var(--overlay-hover) }
.menu button:disabled{ opacity:.5; cursor:wait }
/* 批量更新图标的进度：显示在分类名标签上（标签在按钮左侧，不会被选中滑块或相邻按钮遮挡）；
   「悬停显示」模式下更新期间也强制显示 */
.group-sidebar .item .name.busy{ opacity:1; background:var(--primary); color:var(--on-accent); border-color:transparent; font-variant-numeric:tabular-nums; box-shadow:var(--shadow-sm) }
.menu .danger{ color:var(--danger) }
.ops{ display:flex; align-items:center; justify-content:center; margin-top:6px; pointer-events:auto }
.add{ width:36px; height:36px; border-radius:10px; border:1px solid var(--border); background: var(--glass); backdrop-filter: blur(4px); color:var(--text); cursor:pointer; box-shadow: var(--shadow); transform: translateX(3px) }

.popover-mask{ position:fixed; inset:0; background:var(--scrim); z-index:var(--z-sidebar-pop-mask); pointer-events:auto }
.popover{ position:fixed; right:76px; top:50%; transform: translateY(-50%); width:340px; max-height:calc(100vh - 48px); display:flex; flex-direction:column; background: var(--glass); backdrop-filter: blur(6px); border:1px solid var(--border); border-radius:var(--radius); box-shadow: var(--shadow); padding:12px; pointer-events:auto; z-index:var(--z-sidebar-pop) }

.gname{ display:block; width:100%; box-sizing:border-box; height:34px; border:1px solid var(--border); border-radius:10px; background:var(--bg); color:var(--text); padding:0 10px; margin-bottom:10px }
.icon-picker{ flex:1; min-height:0; max-height:min(420px, 60vh); overflow-y:auto; margin:0 -4px 10px; padding:0 4px; scrollbar-width:thin }
.icon-cat + .icon-cat{ margin-top:10px }
.icon-cat-name{ font-size:12px; color:var(--muted); margin:0 0 6px 2px; letter-spacing:.3px }
.icon-grid{ display:grid; grid-template-columns: repeat(8, 1fr); gap:6px }
.icon-btn{ width:34px; height:34px; padding:0; border-radius:9px; border:1px solid var(--border); background:var(--card); color:var(--text); font-size:18px; display:flex; align-items:center; justify-content:center; cursor:pointer; transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out) }
.icon-btn:hover{ background: var(--surface-active); transform: translateY(-1px) }
.icon-btn:focus-visible{ outline:2px solid var(--primary); outline-offset:1px }
.icon-btn.on{ background: color-mix(in srgb, var(--primary) 28%, transparent); border-color: var(--primary); color:var(--text-strong) }
.confirm{ width:100%; height:34px; border-radius:8px; border:1px solid var(--border); background:var(--card); color:var(--text); cursor:pointer }
.group-sidebar.interactive{ pointer-events:auto }
/* ===== 移动端响应式 ===== */
@media (max-width: 768px) {
  .group-sidebar { display: none }
}
</style>
