/**
 * 网页悬浮按钮组（content script，经典脚本，不能使用 import）
 *
 * 设计要点（对应历史问题）：
 * 1. 样式隔离：UI 放在 closed Shadow DOM 中，宿主元素挂在 <html> 下并以内联
 *    !important 样式固定。网页 CSS（如 button{padding}、body{transform}）无法再改变
 *    按钮尺寸或定位基准。
 * 2. 单一定位模型：位置 = 贴靠边（左/右）+ 距边像素 + 垂直比例，全部由 CSS
 *    min()/calc() 表达，视口变化时浏览器自动重算，无需 resize 监听。
 *    旧版在每次更新星标时调用 freezePosition()，把定位改写为 right/bottom 并用
 *    包含滚动条宽度的 innerWidth 计算，导致按钮横向偏移一个滚动条宽度；
 *    它又会被初始化回调、点击收藏、任意标签页的存储写入触发，表现为「位置偶尔变化」。
 *    现在更新星标只改图标颜色，不触碰任何定位样式。
 * 3. 不直接访问 chrome.storage：全部通过消息交给 background SW
 *    （storage.local 已被限制为仅扩展可信上下文可访问）。
 */
(() => {
  'use strict';

  if (window.top !== window) return;
  if (!/^https?:$/.test(location.protocol)) return;
  if (window.__GCE_FAB_LOADED__) return;
  window.__GCE_FAB_LOADED__ = true;

  // ============ 静态资源 ============

  const CSS = `
:host{all:initial}
*{box-sizing:border-box}
.bar{position:fixed;display:flex;flex-direction:column;gap:4px;padding:6px;border-radius:18px;visibility:hidden;touch-action:none;pointer-events:auto;font-family:"Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif;color:#fff;
  background:linear-gradient(160deg,rgba(255,255,255,.16),rgba(255,255,255,.04) 60%),rgba(17,24,39,.34);
  -webkit-backdrop-filter:blur(18px) saturate(180%);backdrop-filter:blur(18px) saturate(180%);
  border:1px solid rgba(255,255,255,.22);
  box-shadow:0 12px 32px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.32),inset 0 -1px 0 rgba(255,255,255,.06)}
.bar.ready{visibility:visible}
.btn{position:relative;width:36px;height:36px;flex:none;margin:0;padding:0;border-radius:12px;border:1px solid transparent;background:transparent;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;outline:none;font:inherit;filter:drop-shadow(0 1px 1px rgba(0,0,0,.35));transition:background .18s ease,border-color .18s ease,transform .12s ease}
.btn:hover{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.18)}
.btn:active{transform:scale(.94)}
.btn:focus-visible{outline:2px solid #93c5fd;outline-offset:1px}
.btn svg{width:20px;height:20px;display:block;fill:currentColor;pointer-events:none}
.btn.on{color:#facc15}
.btn.move{cursor:grab}
.bar.dragging{cursor:grabbing}
.bar.dragging .btn.move{cursor:grabbing}
.label{position:absolute;right:46px;top:50%;padding:6px 12px;background:rgba(17,24,39,.9);border:1px solid rgba(255,255,255,.16);border-radius:10px;font-size:12px;line-height:1;white-space:nowrap;pointer-events:none;opacity:0;transform:translate(8px,-50%);transition:opacity .18s ease,transform .18s ease;box-shadow:0 6px 18px rgba(0,0,0,.3);filter:none}
.bar.left .label{right:auto;left:46px;transform:translate(-8px,-50%)}
.btn:hover .label{opacity:1;transform:translate(0,-50%)}
.bar.dragging .label{opacity:0}
.qr{position:fixed;top:50%;transform:translateY(-50%);width:220px;padding:16px;border-radius:16px;display:none;flex-direction:column;align-items:center;gap:12px;pointer-events:auto;font-family:"Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif;
  background:linear-gradient(160deg,rgba(255,255,255,.16),rgba(255,255,255,.04) 60%),rgba(17,24,39,.5);
  -webkit-backdrop-filter:blur(18px) saturate(180%);backdrop-filter:blur(18px) saturate(180%);
  border:1px solid rgba(255,255,255,.22);box-shadow:0 16px 36px rgba(0,0,0,.36),inset 0 1px 0 rgba(255,255,255,.3)}
.qr.active{display:flex}
.qr-title{font-size:14px;color:#f3f4f6;text-shadow:0 1px 2px rgba(0,0,0,.4)}
.qr-code{width:180px;height:180px;background:#fff;border-radius:6px;overflow:hidden}
.qr-code canvas,.qr-code img{width:180px!important;height:180px!important;display:block}
.qr-close{position:absolute;top:8px;right:8px;width:22px;height:22px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:6px;cursor:pointer;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.2);font-size:14px;line-height:1;color:#fff}
.toast{position:fixed;left:50%;bottom:40px;transform:translateX(-50%);max-width:80vw;padding:10px 14px;border-radius:12px;color:#fff;font-family:"Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.4;opacity:0;pointer-events:none;transition:opacity .2s ease;
  background:rgba(17,24,39,.6);-webkit-backdrop-filter:blur(16px) saturate(180%);backdrop-filter:blur(16px) saturate(180%);
  border:1px solid rgba(255,255,255,.2);box-shadow:0 10px 26px rgba(0,0,0,.36)}
.toast.show{opacity:1}
.toast.success{background:rgba(37,99,235,.62)}
.toast.error{background:rgba(220,38,38,.7)}
/* 不支持 backdrop-filter 时退化为不透明底色，保证在浅色网页上依然清晰 */
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
  .bar,.qr{background:rgba(17,24,39,.86)}
  .toast{background:rgba(17,24,39,.9)}
}
@media (hover:none) and (pointer:coarse){.label{display:none}}
`;

  // Material Icons（Apache-2.0）路径
  const ICONS = {
    qr: 'M3 11h8V3H3v8zm2-6h4v4H5V5zM3 21h8v-8H3v8zm2-6h4v4H5v-4zM13 3v8h8V3h-8zm6 6h-4V5h4v4zM13 13h2v2h-2zM15 15h2v2h-2zM13 17h2v2h-2zM17 17h2v2h-2zM19 19h2v2h-2zM15 19h2v2h-2zM17 13h2v2h-2zM19 15h2v2h-2z',
    top: 'M5 4h14v2H5V4zm7 4-6 6h4v6h4v-6h4l-6-6z',
    starOutline:
      'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z',
    starFilled: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
    move: 'M10 9h4V6h3l-5-5-5 5h3v3zm-1 1H6V7l-5 5 5 5v-3h3v-4zm14 2-5-5v3h-3v4h3v3l5-5zm-9 3h-4v3H7l5 5 5-5h-3v-3z',
    close:
      'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DEFAULT_PLACEMENT = { side: 'right', x: 12, y: 0.5 };

  // ============ 与 background 通信 ============

  let contextAlive = true;

  /** 扩展被更新/重载后，旧 content script 的 runtime 失效，需要彻底停用 */
  function onContextLost() {
    contextAlive = false;
    unmount();
  }

  function send(type, payload) {
    return new Promise((resolve) => {
      if (!contextAlive) {
        resolve({ ok: false, message: 'context_invalidated' });
        return;
      }
      try {
        chrome.runtime.sendMessage({ type, payload }, (res) => {
          const err = chrome.runtime.lastError;
          if (err) {
            if (/context invalidated/i.test(err.message || '')) onContextLost();
            resolve({ ok: false, message: err.message || '扩展无响应' });
            return;
          }
          resolve(res || { ok: false, message: '扩展无响应' });
        });
      } catch (e) {
        onContextLost();
        resolve({ ok: false, message: String((e && e.message) || e) });
      }
    });
  }

  // ============ 视口 ============

  /** 固定定位元素的包含块尺寸（不含滚动条） */
  function viewport() {
    const el = document.compatMode === 'BackCompat' && document.body ? document.body : document.documentElement;
    return {
      w: el.clientWidth || window.innerWidth || 0,
      h: el.clientHeight || window.innerHeight || 0,
    };
  }

  // ============ UI ============

  /** @type {null | { host: HTMLElement, bar: HTMLElement, qr: HTMLElement, qrCode: HTMLElement, toast: HTMLElement, star: HTMLButtonElement, starPath: SVGPathElement }} */
  let ui = null;
  let placement = { ...DEFAULT_PLACEMENT };
  let bookmarked = false;
  let busy = false;
  let toastTimer = 0;

  function svgIcon(d) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return { svg, path };
  }

  function makeButton(icon, label, cls) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = cls ? `btn ${cls}` : 'btn';
    btn.setAttribute('aria-label', label);
    const { svg, path } = svgIcon(icon);
    btn.appendChild(svg);
    const tip = document.createElement('span');
    tip.className = 'label';
    tip.textContent = label;
    btn.appendChild(tip);
    return { btn, path };
  }

  function showToast(message, type = 'success') {
    if (!ui) return;
    ui.toast.textContent = message;
    ui.toast.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      if (ui) ui.toast.className = 'toast';
    }, 2400);
  }

  function attachStyles(root) {
    try {
      // adoptedStyleSheets 不受网页 CSP 的 style-src 限制
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = CSS;
      root.appendChild(style);
    }
  }

  /** 应用位置：只在初始化、拖拽结束、外部修改位置时调用 */
  function applyPlacement() {
    if (!ui) return;
    const { bar } = ui;
    const r = bar.getBoundingClientRect();
    // 兜底尺寸 = 5 个 36px 按钮 + 4 个 4px 间距 + 6px 内边距 ×2 + 1px 边框 ×2
    const w = Math.ceil(r.width) || 50;
    const h = Math.ceil(r.height) || 210;
    const side = placement.side === 'left' ? 'left' : 'right';
    const other = side === 'left' ? 'right' : 'left';
    const x = Math.max(0, Math.round(placement.x));
    const y = Math.min(1, Math.max(0, placement.y));
    bar.style.setProperty(side, `max(0px, min(${x}px, calc(100% - ${w}px)))`);
    bar.style.setProperty(other, 'auto');
    bar.style.setProperty('top', `max(0px, calc((100% - ${h}px) * ${y}))`);
    bar.style.setProperty('bottom', 'auto');
    bar.classList.toggle('left', side === 'left');
  }

  function setStar(on) {
    bookmarked = !!on;
    if (!ui) return;
    ui.starPath.setAttribute('d', bookmarked ? ICONS.starFilled : ICONS.starOutline);
    ui.star.classList.toggle('on', bookmarked);
    const text = bookmarked ? '取消收藏' : '收藏到 GCE';
    ui.star.setAttribute('aria-label', text);
    const tip = ui.star.querySelector('.label');
    if (tip) tip.textContent = text;
  }

  /** 当前页面声明的图标地址（浏览器已加载过，后台再次请求不泄露新信息） */
  function pageIconLinks() {
    const out = [];
    for (const el of document.querySelectorAll('link[rel][href]')) {
      const rel = (el.getAttribute('rel') || '').toLowerCase();
      if (!/(^|\s)(icon|shortcut|apple-touch-icon(-precomposed)?)(\s|$)/.test(rel)) continue;
      const href = el.href;
      if (/^https?:\/\//i.test(href) && !out.includes(href)) out.push(href);
      if (out.length >= 4) break;
    }
    return out;
  }

  async function onStarClick() {
    if (busy) return;
    busy = true;
    try {
      if (bookmarked) {
        const res = await send('GCE_REMOVE_BOOKMARK', { url: location.href });
        if (!res.ok) {
          showToast(res.message || '取消收藏失败', 'error');
          return;
        }
        setStar(false);
        showToast(res.removed ? '已取消收藏' : '该页面未收藏');
      } else {
        const res = await send('GCE_ADD_BOOKMARK', {
          url: location.href,
          title: document.title || location.href,
          icons: pageIconLinks(),
        });
        if (!res.ok) {
          showToast(res.message || '收藏失败', 'error');
          return;
        }
        setStar(true);
        showToast(res.duplicated ? '已在 GCE 中' : '已添加到 GCE');
      }
    } finally {
      busy = false;
    }
  }

  function toggleQr() {
    if (!ui) return;
    const { qr, qrCode, bar } = ui;
    if (qr.classList.contains('active')) {
      qr.classList.remove('active');
      qrCode.textContent = '';
      return;
    }
    const QR = window.QRCode;
    if (typeof QR !== 'function') {
      showToast('二维码组件未加载', 'error');
      return;
    }
    qrCode.textContent = '';
    try {
      new QR(qrCode, {
        text: location.href,
        width: 180,
        height: 180,
        colorDark: '#111111',
        colorLight: '#ffffff',
        correctLevel: (QR.CorrectLevel && QR.CorrectLevel.M) || 0,
      });
    } catch {
      showToast('二维码生成失败', 'error');
      return;
    }
    // 面板放在按钮组靠视口中心的一侧
    const r = bar.getBoundingClientRect();
    const vw = viewport().w;
    if (placement.side === 'left') {
      qr.style.left = `${Math.round(r.right + 12)}px`;
      qr.style.right = 'auto';
    } else {
      qr.style.right = `${Math.round(vw - r.left + 12)}px`;
      qr.style.left = 'auto';
    }
    qr.classList.add('active');
  }

  function attachDrag(handle) {
    let drag = null;

    handle.addEventListener('pointerdown', (e) => {
      if (!ui || e.button !== 0) return;
      e.preventDefault();
      const r = ui.bar.getBoundingClientRect();
      drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height, moved: false, sx: e.clientX, sy: e.clientY };
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        /* 忽略 */
      }
    });

    handle.addEventListener('pointermove', (e) => {
      if (!ui || !drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 3) return;
      drag.moved = true;
      ui.bar.classList.add('dragging');
      const vp = viewport();
      const left = Math.min(Math.max(0, e.clientX - drag.dx), Math.max(0, vp.w - drag.w));
      const top = Math.min(Math.max(0, e.clientY - drag.dy), Math.max(0, vp.h - drag.h));
      const s = ui.bar.style;
      s.setProperty('left', `${left}px`);
      s.setProperty('top', `${top}px`);
      s.setProperty('right', 'auto');
      s.setProperty('bottom', 'auto');
    });

    const end = (e) => {
      if (!ui || !drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      ui.bar.classList.remove('dragging');
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        /* 忽略 */
      }
      if (!d.moved) return;
      const r = ui.bar.getBoundingClientRect();
      const vp = viewport();
      const side = r.left + r.width / 2 < vp.w / 2 ? 'left' : 'right';
      const room = vp.h - r.height;
      placement = {
        side,
        x: Math.round(side === 'left' ? r.left : vp.w - r.right),
        y: room > 0 ? Math.min(1, Math.max(0, r.top / room)) : 0.5,
      };
      applyPlacement();
      void send('GCE_FAB_PATCH', { placement });
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  function mount() {
    if (ui) {
      if (!ui.host.isConnected) document.documentElement.appendChild(ui.host);
      return;
    }
    const host = document.createElement('gce-fab-root');
    host.setAttribute(
      'style',
      'all:initial!important;position:fixed!important;top:0!important;left:0!important;width:0!important;height:0!important;display:block!important;z-index:2147483647!important;pointer-events:none!important;'
    );
    const root = host.attachShadow({ mode: 'closed' });
    attachStyles(root);

    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'GCE');

    const qrBtn = makeButton(ICONS.qr, '生成二维码');
    const topBtn = makeButton(ICONS.top, '返回顶部');
    const starBtn = makeButton(ICONS.starOutline, '收藏到 GCE');
    const moveBtn = makeButton(ICONS.move, '按住拖动', 'move');
    const closeBtn = makeButton(ICONS.close, '关闭悬浮按钮');
    bar.append(qrBtn.btn, topBtn.btn, starBtn.btn, moveBtn.btn, closeBtn.btn);

    const qr = document.createElement('div');
    qr.className = 'qr';
    const qrClose = document.createElement('button');
    qrClose.type = 'button';
    qrClose.className = 'qr-close';
    qrClose.setAttribute('aria-label', '关闭二维码');
    qrClose.textContent = '×';
    const qrTitle = document.createElement('div');
    qrTitle.className = 'qr-title';
    qrTitle.textContent = '扫码打开当前页面';
    const qrCode = document.createElement('div');
    qrCode.className = 'qr-code';
    qr.append(qrClose, qrTitle, qrCode);

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');

    root.append(bar, qr, toast);
    document.documentElement.appendChild(host);

    ui = { host, bar, qr, qrCode, toast, star: starBtn.btn, starPath: starBtn.path };

    qrBtn.btn.addEventListener('click', toggleQr);
    qrClose.addEventListener('click', toggleQr);
    topBtn.btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    starBtn.btn.addEventListener('click', () => void onStarClick());
    closeBtn.btn.addEventListener('click', async () => {
      const res = await send('GCE_FAB_PATCH', { enabled: false });
      if (res.ok) unmount();
      else showToast(res.message || '操作失败', 'error');
    });
    attachDrag(moveBtn.btn);

    setStar(bookmarked);
    applyPlacement();
    bar.classList.add('ready');
  }

  function unmount() {
    if (!ui) return;
    clearTimeout(toastTimer);
    ui.host.remove();
    ui = null;
  }

  // ============ 状态同步 ============

  let refreshing = false;
  let lastUrl = location.href;

  async function refresh() {
    if (!contextAlive || refreshing) return;
    refreshing = true;
    try {
      const res = await send('GCE_FAB_STATE', { url: location.href });
      if (!res.ok) return;
      if (!res.enabled) {
        unmount();
        return;
      }
      const p = res.placement || DEFAULT_PLACEMENT;
      const moved = !ui || p.side !== placement.side || p.x !== placement.x || p.y !== placement.y;
      placement = { side: p.side, x: p.x, y: p.y };
      bookmarked = !!res.bookmarked;
      const firstMount = !ui;
      mount();
      setStar(bookmarked);
      if (moved && !firstMount) applyPlacement();
    } finally {
      refreshing = false;
    }
  }

  function onUrlMaybeChanged() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    if (ui && ui.qr.classList.contains('active')) toggleQr();
    void refresh();
  }

  // 其它标签页 / 设置页可能修改了开关、位置或书签：页面重新可见时同步
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh();
  });
  window.addEventListener('focus', () => void refresh());
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) void refresh();
  });
  // 单页应用切换路由时星标要跟着当前 URL 变化
  if (window.navigation && typeof window.navigation.addEventListener === 'function') {
    window.navigation.addEventListener('navigatesuccess', onUrlMaybeChanged);
  } else {
    window.addEventListener('popstate', onUrlMaybeChanged);
    window.addEventListener('hashchange', onUrlMaybeChanged);
  }

  void refresh();
})();
