/**
 * 「访问所有网站」权限（manifest 中的 optional_host_permissions，开启悬浮按钮时才申请）
 *
 * 只有悬浮按钮需要在网页里运行脚本，因此只在用户开启它时申请；关闭悬浮按钮时一并归还。
 * 授权后获取图标也会直接请求网站（质量更好），未授权时只读取浏览器缓存的图标（见 favicon.js）。
 */

/** @type {chrome.permissions.Permissions} */
export const ALL_SITES = { origins: ['https://*/*', 'http://*/*'] };

export async function hasAllSites() {
  try {
    return !!(await chrome.permissions?.contains?.(ALL_SITES));
  } catch {
    return false;
  }
}

/**
 * 申请权限。浏览器要求在用户操作（点击 / 勾选）的处理函数中调用，
 * 调用之前不能有 await，否则会被拒绝。
 * @returns {Promise<boolean>} 是否已获授权
 */
export function requestAllSites() {
  return chrome.permissions.request(ALL_SITES).catch(() => false);
}

export function removeAllSites() {
  return chrome.permissions.remove(ALL_SITES).catch(() => false);
}
