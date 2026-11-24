<template>
  <div ref="gridRef" class="grid">
    <div
      v-for="(b, i) in bookmarks"
      :key="b.id"
      class="bm-item"
      :data-id="b.id"
      :style="{ '--i': i }"
    >
      <BookmarkCard :bookmark="b" @edit="(x) => emit('edit', x)" />
    </div>
    <div class="no-drag"><slot></slot></div>
  </div>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import Sortable from 'sortablejs';
import BookmarkCard from './BookmarkCard.vue';
import type { Bookmark } from '../../core/types/model';
import { useBookmarks } from '../../core/store/useBookmarks';
import { notifyError } from '../../core/store/useStorage';
import { dragging, endDrag, moveId, revertSortableMove } from '../../core/utils/dragState';

const props = defineProps<{ bookmarks: Bookmark[]; groupId: string }>();
const emit = defineEmits<{ (e: 'edit', b: Bookmark): void }>();

const gridRef = ref<HTMLDivElement>();
const bm = useBookmarks();
let sortable: Sortable | null = null;

onMounted(() => {
  if (!gridRef.value) return;
  sortable = Sortable.create(gridRef.value, {
    animation: 150,
    ghostClass: 'drag-ghost',
    draggable: '.bm-item',
    filter: '.no-drag',
    // 拖到 Dock / 分组侧栏 / 其它应用时携带的数据
    setData(dt, el) {
      const b = props.bookmarks.find((x) => x.id === el.dataset.id);
      if (!b) return;
      dt.setData('text/uri-list', b.url);
      dt.setData('text/plain', b.url);
    },
    onStart(evt) {
      const id = (evt.item as HTMLElement).dataset.id;
      if (id) dragging.value = { id, source: 'grid' };
    },
    onEnd: () => endDrag(),
    // 仅在组内顺序真的变化时触发
    onUpdate(evt) {
      const from = evt.oldDraggableIndex;
      const to = evt.newDraggableIndex;
      revertSortableMove(evt);
      if (from === undefined || to === undefined || from === to) return;
      const ids = moveId(props.bookmarks.map((b) => b.id), from, to);
      bm.reorderWithinGroup(props.groupId, ids).catch((err) => notifyError(err));
    },
  });
});

onBeforeUnmount(() => {
  sortable?.destroy();
  sortable = null;
});
</script>
<style scoped>
.grid{ display:flex; flex-wrap:wrap; gap:8px; justify-content:center; }
.bm-item{ min-width:0; overflow:visible; }
.drag-ghost{ opacity:.6; }
@media (max-width: 768px) {
  .grid { gap: 6px }
}
</style>
