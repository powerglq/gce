/**
 * 浮动面板拖拽（可缩放）
 *
 * 抽取原因：NotebookPanel / SettingsDrawer / SharedItemsPanel 三个面板
 * 各自的拖拽逻辑近乎逐行重复，且历史上都踩过同一个坑 ——
 * 首次拖拽时用「硬编码猜的默认尺寸」反推面板位置，
 * 而面板实际是用 `left:50%; top:50%; transform:translate(-50%,-50%)` 居中的。
 * 只要 CSS 的实际尺寸与代码假设不一致（响应式断点下差得更远），
 * 首次按下拖拽就会「跳一下」，之后因为 pos 已被持久化才看起来正常。
 *
 * 正确做法：位置与尺寸一律以 DOM 实测的 getBoundingClientRect() 为准，
 * 永远不猜。
 *
 * 另一个要点：pos 为 null 表示「用 CSS 居中」，一旦用户拖过就切换为
 * 显式 left/top（transform 置 none），两种定位方式互斥，避免叠加偏移。
 */
import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

export interface PanelPos {
  left: number;
  top: number;
}
export interface PanelSize {
  w: number;
  h: number;
}

export interface DraggablePanelOptions {
  /** 面板根元素 */
  elRef: Ref<HTMLElement | null>;
  /** 是否启用缩放（右下角手柄） */
  resizable?: boolean;
  /** 缩放尺寸的最小值 */
  minSize?: { w: number; h: number };
  /** 初始尺寸（仅当 el 尚未渲染时作为兜底） */
  fallbackSize?: { w: number; h: number };
  /** 位置变化后持久化 */
  savePos?: (p: PanelPos) => void;
  /** 尺寸变化后持久化 */
  saveSize?: (s: PanelSize) => void;
  /** 视口内的最小边距 */
  margin?: number;
}

export function useDraggablePanel(opts: DraggablePanelOptions) {
  const {
    elRef,
    resizable = false,
    minSize,
    fallbackSize,
    savePos,
    saveSize,
    margin = 8,
  } = opts;

  const pos = ref<PanelPos | null>(null);
  const size = ref<PanelSize | null>(null);
  const dragging = ref(false);
  const resizing = ref(false);

  const dragBase = ref<{ x: number; y: number; left: number; top: number } | null>(null);
  const resizeBase = ref<{ x: number; y: number; w: number; h: number } | null>(null);

  /** 实测当前面板尺寸（以 DOM 为准，绝不用硬编码猜） */
  function measure(): { w: number; h: number } {
    const el = elRef.value;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return { w: r.width, h: r.height };
    }
    if (size.value) return { ...size.value };
    return { ...(fallbackSize || { w: 780, h: 560 }) };
  }

  /**
   * 读取面板当前的实际左上角位置。
   * pos 为 null 时面板由 CSS transform 居中，必须用 rect 换算，
   * 否则会得到错误的位置（首次拖拽跳变的根因）。
   */
  function currentPos(): PanelPos {
    if (pos.value) return { ...pos.value };
    const el = elRef.value;
    if (el) {
      const r = el.getBoundingClientRect();
      if (Number.isFinite(r.left) && Number.isFinite(r.top)) {
        return { left: Math.round(r.left), top: Math.round(r.top) };
      }
    }
    // 极端兜底：元素尚未渲染
    const m = measure();
    return {
      left: Math.round(Math.max(margin, (window.innerWidth - m.w) / 2)),
      top: Math.round(Math.max(margin, (window.innerHeight - m.h) / 2)),
    };
  }

  function clamp(left: number, top: number, m?: { w: number; h: number }): PanelPos {
    const sizeNow = m || measure();
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    return {
      left: Math.max(margin, Math.min(Math.max(margin, vw - sizeNow.w - margin), left)),
      top: Math.max(margin, Math.min(Math.max(margin, vh - sizeNow.h - margin), top)),
    };
  }

  /**
   * 指针按下点是否落在交互控件上。
   *
   * 这一步是必需的，不是优化：onDragStart 会立刻对拖拽把手 setPointerCapture，
   * 而指针捕获生效后，浏览器会把后续的 click 重定向到捕获元素。
   * 于是「从关闭按钮上按下」会变成「拖拽标题栏」，按钮的 click 永远不触发——
   * 表现为关闭按钮点不动。
   *
   * 只要把交互控件排除在拖拽之外，这个陷阱对所有使用方自动失效，
   * 以后往标题栏里加新控件也不必再逐个补选择器。
   */
  function isInteractiveTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || typeof el.closest !== 'function') return false;
    return !!el.closest('button, a[href], input, select, textarea, [role="button"], [data-no-drag]');
  }

  /** 拖拽开始：必须先实测当前位置，再以它为基准 */
  function onDragStart(e: PointerEvent) {
    if (isInteractiveTarget(e.target)) return;
    const start = currentPos();
    pos.value = start;
    dragBase.value = { x: e.clientX, y: e.clientY, left: start.left, top: start.top };
    dragging.value = true;
    try { (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId); } catch { /* 忽略 */ }

    const onMove = (ev: PointerEvent) => {
      if (!dragBase.value) return;
      pos.value = clamp(
        dragBase.value.left + ev.clientX - dragBase.value.x,
        dragBase.value.top + ev.clientY - dragBase.value.y,
      );
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      dragging.value = false;
      dragBase.value = null;
      if (pos.value) savePos?.({ ...pos.value });
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  }

  /** 缩放开始 */
  function onResizeStart(e: PointerEvent) {
    if (!resizable) return;
    e.preventDefault();
    e.stopPropagation();
    const el = elRef.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const m = measure();
    // 缩放前先固定位置与尺寸，避免缩放过程中面板因 left/top 未定而跳动
    if (!pos.value) pos.value = { left: Math.round(rect.left), top: Math.round(rect.top) };
    if (!size.value) size.value = { w: m.w, h: m.h };

    resizeBase.value = { x: e.clientX, y: e.clientY, w: m.w, h: m.h };
    resizing.value = true;
    try { (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId); } catch { /* 忽略 */ }

    const onMove = (ev: PointerEvent) => {
      const b = resizeBase.value;
      if (!b || !pos.value) return;
      const min = minSize || { w: 320, h: 240 };
      const vw = window.innerWidth || 0;
      const vh = window.innerHeight || 0;
      size.value = {
        w: Math.round(Math.max(min.w, Math.min(vw - pos.value.left - margin, b.w + ev.clientX - b.x))),
        h: Math.round(Math.max(min.h, Math.min(vh - pos.value.top - margin, b.h + ev.clientY - b.y))),
      };
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      resizing.value = false;
      resizeBase.value = null;
      if (size.value) saveSize?.({ ...size.value });
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  }

  /**
   * 定位样式
   * pos 为 null → CSS 居中（与组件内 CSS 保持一致）；否则显式 left/top。
   */
  const positionStyle = computed(() => {
    const s: Record<string, string> = {};
    if (pos.value) {
      s.left = `${pos.value.left}px`;
      s.top = `${pos.value.top}px`;
      s.transform = 'none';
    } else {
      s.left = '50%';
      s.top = '50%';
      s.transform = 'translate(-50%, -50%)';
    }
    if (size.value) {
      s.width = `${size.value.w}px`;
      s.height = `${size.value.h}px`;
    }
    return s;
  });

  /** 面板打开时恢复持久化的位置/尺寸 */
  function restoreFromStore(p?: PanelPos, s?: PanelSize) {
    pos.value = p ? { left: p.left, top: p.top } : null;
    size.value = s ? { w: s.w, h: s.h } : null;
  }

  /** 视口尺寸变化时把面板拉回可见区域 */
  function ensureVisible() {
    if (!pos.value) return;
    pos.value = clamp(pos.value.left, pos.value.top);
  }

  onMounted(() => window.addEventListener('resize', ensureVisible));
  onBeforeUnmount(() => window.removeEventListener('resize', ensureVisible));

  return {
    pos,
    size,
    dragging,
    resizing,
    measure,
    clamp,
    currentPos,
    onDragStart,
    onResizeStart,
    positionStyle,
    restoreFromStore,
    ensureVisible,
  };
}
