import { shallowRef } from 'vue';

/**
 * 页面内书签拖拽状态（网格 → Dock / 分组侧栏；Dock → 分组侧栏 / 拖出移除）
 *
 * 用一个响应式状态代替旧版的 window CustomEvent 广播：
 * 发起方在开始拖拽时写入，放置目标在 drop 时读取。
 */
export interface DragInfo {
  id: string;
  source: 'grid' | 'dock';
}

export const dragging = shallowRef<DragInfo | null>(null);

/**
 * 结束拖拽。延迟清理：drop 目标的处理函数要先读到状态，
 * 而 Sortable 的 onEnd（dragend）与 drop 的先后在不同场景下不一致。
 */
export function endDrag(delayMs = 120): void {
  const cur = dragging.value;
  setTimeout(() => {
    if (dragging.value === cur) dragging.value = null;
  }, delayMs);
}

/**
 * Sortable 会直接移动 DOM 节点，而列表由 Vue 的 v-for 渲染。
 * 先把节点放回原位，再由数据驱动重新渲染，避免 DOM 与虚拟 DOM 不一致。
 */
export function revertSortableMove(evt: { item: HTMLElement; from: HTMLElement; oldIndex?: number }): void {
  const { item, from, oldIndex } = evt;
  if (oldIndex === undefined) return;
  from.removeChild(item);
  from.insertBefore(item, from.children[oldIndex] ?? null);
}

/** 把 id 列表中 from 位置的元素移到 to 位置（返回新数组） */
export function moveId(ids: string[], from: number, to: number): string[] {
  const next = ids.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
