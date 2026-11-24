import { watch } from 'vue';
import type { ColorScheme } from '../types/model';

/**
 * 主题切换：只设置 <html data-theme>，颜色全部由 tokens.css 中对应的令牌决定。
 *
 * 设置保存在 chrome.storage（异步读取），为避免浅色用户每次打开新标签页先闪一下深色，
 * 另在 localStorage 缓存一份，页面挂载前同步读取。缓存只用于首帧，以存储中的设置为准。
 */
const CACHE_KEY = 'gce_color_scheme';
const media = window.matchMedia('(prefers-color-scheme: light)');

function paint(mode: ColorScheme) {
  const resolved = mode === 'system' ? (media.matches ? 'light' : 'dark') : mode;
  document.documentElement.dataset.theme = resolved;
}

/** 挂载前调用：按缓存先绘制首帧 */
export function applyCachedTheme() {
  const m = localStorage.getItem(CACHE_KEY);
  paint(m === 'light' || m === 'system' ? m : 'dark');
}

/** 跟随设置与系统主题变化 */
export function syncTheme(getMode: () => ColorScheme) {
  watch(
    getMode,
    (m) => {
      paint(m);
      localStorage.setItem(CACHE_KEY, m);
    },
    { immediate: true }
  );
  media.addEventListener('change', () => paint(getMode()));
}
