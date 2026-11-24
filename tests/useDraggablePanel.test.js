// @vitest-environment jsdom
/**
 * 浮动面板拖拽测试
 *
 * 回归重点：用户报告的「首次拖拽错位，之后正常」。
 *
 * 根因：面板初始由 CSS `left:50%; top:50%; transform:translate(-50%,-50%)` 居中，
 * 而旧实现首次拖拽时用「硬编码猜的默认尺寸」反推左上角坐标。
 * 只要 CSS 实际尺寸与假设不一致（响应式断点下差得更远），
 * 按下拖拽的瞬间面板就会跳一下；之后 pos 被持久化，看起来才正常。
 *
 * 修复：位置与尺寸一律以 getBoundingClientRect() 实测为准。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defineComponent, h, ref, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { useDraggablePanel } from '../extension/src/core/composables/useDraggablePanel.ts';

/** 造一个固定尺寸的元素，并让 getBoundingClientRect 返回指定值 */
function makeEl(width, height, left, top) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  el.getBoundingClientRect = () => ({
    width, height, left, top,
    right: left + width, bottom: top + height,
    x: left, y: top, toJSON: () => ({}),
  });
  return el;
}

function pointer(x, y, target) {
  const ev = new Event('pointerdown', { bubbles: true });
  ev.clientX = x; ev.clientY = y; ev.pointerId = 1;
  // target / currentTarget 在原生 Event 上是只读 getter，需用 defineProperty 覆盖
  Object.defineProperty(ev, 'target', { value: target });
  Object.defineProperty(ev, 'currentTarget', { value: target });
  return ev;
}

beforeEach(() => {
  document.body.innerHTML = '';
  // 固定视口尺寸，避免测试间相互影响
  Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 900, writable: true, configurable: true });
});

describe('currentPos - 位置必须来自 DOM 实测', () => {
  it('pos 为 null（CSS 居中）时，用 rect 换算真实左上角，而不是猜尺寸', async () => {
    // 真实渲染尺寸 780×560，视口 1200×900 → 居中后左上角应为 (210, 170)
    const el = makeEl(780, 560, 210, 170);
    let api;
    const C = defineComponent({
      setup() {
        const elRef = ref(el);
        api = useDraggablePanel({ elRef, fallbackSize: { w: 999, h: 999 } });
        return () => h('div');
      },
    });
    mount(C);
    await nextTick();

    const p = api.currentPos();
    expect(p.left).toBe(210);
    expect(p.top).toBe(170);
  });

  it('fallbackSize 与实际不符时，仍以 rect 为准（旧实现在这里会错）', async () => {
    const el = makeEl(420, 480, 100, 80); // 模拟移动端断点下的真实尺寸
    let api;
    const C = defineComponent({
      setup() {
        const elRef = ref(el);
        // 故意给一个与 CSS 完全不符的 fallback
        api = useDraggablePanel({ elRef, fallbackSize: { w: 780, h: 560 } });
        return () => h('div');
      },
    });
    mount(C);
    await nextTick();

    expect(api.currentPos()).toEqual({ left: 100, top: 80 });
  });

  it('pos 已有值时直接返回该值', async () => {
    const el = makeEl(780, 560, 0, 0);
    let api;
    const C = defineComponent({
      setup() {
        const elRef = ref(el);
        api = useDraggablePanel({ elRef });
        return () => h('div');
      },
    });
    mount(C);
    await nextTick();
    api.restoreFromStore({ left: 33, top: 44 }, undefined);
    expect(api.currentPos()).toEqual({ left: 33, top: 44 });
  });
});

describe('onDragStart - 首次拖拽不跳变', () => {
  it('首次拖拽时基准位置等于实测位置，位移 0 时面板原地不动', async () => {
    const el = makeEl(780, 560, 210, 170);
    const handle = document.createElement('div');
    document.body.appendChild(handle);
    let api;
    const C = defineComponent({
      setup() {
        const elRef = ref(el);
        api = useDraggablePanel({ elRef });
        return () => h('div');
      },
    });
    mount(C);
    await nextTick();

    const before = api.currentPos();
    api.onDragStart(pointer(before.left + 100, before.top + 100, handle));

    // 按下但未移动 → 位置不应改变
    expect(api.pos.value).toEqual(before);
  });

  it('拖拽位移正确映射到面板位置', async () => {
    const el = makeEl(780, 560, 210, 170);
    const handle = document.createElement('div');
    document.body.appendChild(handle);
    let api;
    const C = defineComponent({
      setup() {
        const elRef = ref(el);
        api = useDraggablePanel({ elRef });
        return () => h('div');
      },
    });
    mount(C);
    await nextTick();

    api.onDragStart(pointer(300, 300, handle));
    // 模拟向右下移动 40/25
    const move = new Event('pointermove');
    move.clientX = 340; move.clientY = 325;
    window.dispatchEvent(move);

    expect(api.pos.value.left).toBe(250);   // 210 + 40
    expect(api.pos.value.top).toBe(195);    // 170 + 25
  });

  it('松手后调用 savePos 持久化', async () => {
    const el = makeEl(780, 560, 210, 170);
    const handle = document.createElement('div');
    document.body.appendChild(handle);
    const savePos = vi.fn();
    let api;
    const C = defineComponent({
      setup() {
        const elRef = ref(el);
        api = useDraggablePanel({ elRef, savePos });
        return () => h('div');
      },
    });
    mount(C);
    await nextTick();

    api.onDragStart(pointer(300, 300, handle));
    const move = new Event('pointermove');
    move.clientX = 350; move.clientY = 300;
    window.dispatchEvent(move);
    window.dispatchEvent(new Event('pointerup'));

    expect(savePos).toHaveBeenCalledTimes(1);
    expect(savePos.mock.calls[0][0].left).toBe(260);
  });

  it('松手后移除全局监听（不残留）', async () => {
    const el = makeEl(780, 560, 210, 170);
    const handle = document.createElement('div');
    document.body.appendChild(handle);
    let api;
    const C = defineComponent({
      setup() {
        const elRef = ref(el);
        api = useDraggablePanel({ elRef });
        return () => h('div');
      },
    });
    mount(C);
    await nextTick();

    api.onDragStart(pointer(300, 300, handle));
    window.dispatchEvent(new Event('pointerup'));
    const settled = api.pos.value;

    // 之后再移动指针不应改变位置
    const move = new Event('pointermove');
    move.clientX = 999; move.clientY = 999;
    window.dispatchEvent(move);
    expect(api.pos.value).toEqual(settled);
  });
});

describe('clamp - 面板不会被拖出视口', () => {
  it('左侧/上侧不留出视口', async () => {
    const el = makeEl(780, 560, 0, 0);
    let api;
    const C = defineComponent({
      setup() {
        const elRef = ref(el);
        api = useDraggablePanel({ elRef });
        return () => h('div');
      },
    });
    mount(C);
    await nextTick();
    expect(api.clamp(-500, -500)).toEqual({ left: 8, top: 8 });
  });

  it('右侧/下侧留出边距（以实测尺寸计算）', async () => {
    const el = makeEl(780, 560, 0, 0);
    let api;
    const C = defineComponent({
      setup() {
        const elRef = ref(el);
        api = useDraggablePanel({ elRef });
        return () => h('div');
      },
    });
    mount(C);
    await nextTick();
    // 视口 1200×900，面板 780×560 → 最大 left = 1200-780-8 = 412
    const r = api.clamp(9999, 9999);
    expect(r.left).toBe(412);
    expect(r.top).toBe(332); // 900-560-8
  });
});

describe('positionStyle - 定位样式与 pos 状态一致', () => {
  it('pos 为 null 时用 CSS 居中（transform 居中）', async () => {
    const el = makeEl(780, 560, 0, 0);
    let api;
    const C = defineComponent({
      setup() {
        const elRef = ref(el);
        api = useDraggablePanel({ elRef });
        return () => h('div');
      },
    });
    mount(C);
    await nextTick();
    expect(api.positionStyle.value).toMatchObject({
      left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
    });
  });

  it('pos 有值时改为显式坐标且 transform 置 none（两种定位互斥）', async () => {
    const el = makeEl(780, 560, 0, 0);
    let api;
    const C = defineComponent({
      setup() {
        const elRef = ref(el);
        api = useDraggablePanel({ elRef });
        return () => h('div');
      },
    });
    mount(C);
    await nextTick();
    api.restoreFromStore({ left: 120, top: 90 }, undefined);
    expect(api.positionStyle.value).toMatchObject({
      left: '120px', top: '90px', transform: 'none',
    });
  });
});

describe('restoreFromStore / ensureVisible', () => {
  it('恢复位置与尺寸', async () => {
    const el = makeEl(780, 560, 0, 0);
    let api;
    const C = defineComponent({
      setup() {
        const elRef = ref(el);
        api = useDraggablePanel({ elRef, resizable: true });
        return () => h('div');
      },
    });
    mount(C);
    await nextTick();
    api.restoreFromStore({ left: 50, top: 60 }, { w: 600, h: 400 });
    expect(api.pos.value).toEqual({ left: 50, top: 60 });
    expect(api.size.value).toEqual({ w: 600, h: 400 });
  });

  it('未保存过时保持 null（走 CSS 居中）', async () => {
    const el = makeEl(780, 560, 0, 0);
    let api;
    const C = defineComponent({
      setup() {
        const elRef = ref(el);
        api = useDraggablePanel({ elRef });
        return () => h('div');
      },
    });
    mount(C);
    await nextTick();
    api.restoreFromStore(undefined, undefined);
    expect(api.pos.value).toBeNull();
  });

  it('视口缩小后把面板拉回可见范围', async () => {
    const el = makeEl(780, 560, 0, 0);
    let api;
    const C = defineComponent({
      setup() {
        const elRef = ref(el);
        api = useDraggablePanel({ elRef });
        return () => h('div');
      },
    });
    mount(C);
    await nextTick();
    api.restoreFromStore({ left: 1000, top: 800 }, undefined);
    api.ensureVisible();
    expect(api.pos.value.left).toBeLessThanOrEqual(412);
    expect(api.pos.value.top).toBeLessThanOrEqual(332);
  });

  /**
   * 回归：关闭按钮点不动。
   *
   * 根因：onDragStart 在 pointerdown 阶段就 setPointerCapture(拖拽把手)。
   * 指针捕获生效后浏览器把后续 click 重定向到捕获元素，
   * 于是「在关闭按钮上按下」变成「拖动标题栏」，按钮的 click 永不触发。
   * 修复：交互控件一律不进入拖拽。
   */
  describe('交互控件不触发拖拽', () => {
    async function dragFrom(inner) {
      const el = makeEl(780, 560, 100, 100);
      const handle = document.createElement('header');
      handle.appendChild(inner);
      el.appendChild(handle);

      let api;
      const C = defineComponent({
        setup() {
          const elRef = ref(el);
          api = useDraggablePanel({ elRef });
          return () => h('div');
        },
      });
      mount(C);
      await nextTick();

      // 模拟真实事件流：pointerdown 从 inner 冒泡到把手，target 是 inner
      api.onDragStart(pointer(200, 200, inner));
      window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 260, clientY: 240 }));
      window.dispatchEvent(new Event('pointerup'));
      return api;
    }

    it('从关闭按钮按下时不开始拖拽', async () => {
      const btn = document.createElement('button');
      btn.className = 'gce-panel-close';
      const api = await dragFrom(btn);
      expect(api.pos.value).toBeNull();
      expect(api.dragging.value).toBe(false);
    });

    it('从普通按钮按下时不开始拖拽', async () => {
      const api = await dragFrom(document.createElement('button'));
      expect(api.pos.value).toBeNull();
    });

    it('从 input / select / textarea 按下时不开始拖拽', async () => {
      for (const tag of ['input', 'select', 'textarea']) {
        expect((await dragFrom(document.createElement(tag))).pos.value).toBeNull();
      }
    });

    it('从 role=button 元素按下时不开始拖拽', async () => {
      const roleBtn = document.createElement('span');
      roleBtn.setAttribute('role', 'button');
      expect((await dragFrom(roleBtn)).pos.value).toBeNull();
    });

    it('从 data-no-drag 元素按下时不开始拖拽', async () => {
      const el = document.createElement('div');
      el.setAttribute('data-no-drag', '');
      expect((await dragFrom(el)).pos.value).toBeNull();
    });

    // 关键对照：守卫不能把正常拖拽也一起拦掉，否则标题栏就拖不动了
    it('从标题栏空白处按下时仍然正常拖拽', async () => {
      const label = document.createElement('div');
      const api = await dragFrom(label);
      expect(api.pos.value).not.toBeNull();
      expect(api.pos.value.left).toBe(160);
      expect(api.pos.value.top).toBe(140);
    });
  });
});
