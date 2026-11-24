/**
 * 唯一 ID 生成实现
 *
 * 历史上项目内有 6 处各自实现（core/utils/uid.ts、useNotebook.makeId、
 * background.genId、useNotebook 两处内联、backup.ts 一处），
 * 格式互不一致。这里收敛为一份，供 newtab 页与 background SW 共用。
 */
/**
 * 生成带前缀的唯一 ID
 * @param {string} [prefix] ID 前缀，如 'bm-'
 * @returns {string}
 */
export function uid(prefix = '') {
  let part;
  try {
    const rand = crypto?.getRandomValues?.(new Uint32Array(2));
    part = rand
      ? Array.from(rand).map((n) => n.toString(16)).join('')
      : Math.random().toString(16).slice(2);
  } catch {
    part = Math.random().toString(16).slice(2);
  }
  return `${prefix}${Date.now().toString(36)}-${part}`;
}
