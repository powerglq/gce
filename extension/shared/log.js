// 轻量日志（ESP-IDF 风格）：LOGI('BG', '已启动'); LOGW('BG', '网络缓慢'); LOGE('BG', '异常', err)
const fmt = (tag) => String(tag || 'GCE');

/** @param {string} tag @param {...unknown} args */
export function LOGI(tag, ...args) {
  console.log(`I(${fmt(tag)}):`, ...args);
}
/** @param {string} tag @param {...unknown} args */
export function LOGW(tag, ...args) {
  console.warn(`W(${fmt(tag)}):`, ...args);
}
/** @param {string} tag @param {...unknown} args */
export function LOGE(tag, ...args) {
  console.error(`E(${fmt(tag)}):`, ...args);
}
