// 全局常量（集中管理；只放常量，不引入运行时副作用）

/** 站点信息（标题 / 图标）缓存键：添加书签时按页面地址缓存抓取结果 */
export const SITE_CACHE_KEY = 'gce_site_cache_v1';
/** 站点缓存有效期（毫秒），默认 7 天 */
export const SITE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 记事本：图片附件最大数量 */
export const NOTEBOOK_IMAGE_MAX_COUNT = 12;
/** 记事本：单张图片最大字节数 */
export const NOTEBOOK_IMAGE_MAX_BYTES = 1500 * 1024;
/** 记事本：图片附件总大小上限（字节） */
export const NOTEBOOK_IMAGE_MAX_TOTAL_BYTES = 3 * 1024 * 1024;

/** 背景图：不超过该体积的原图直接保存（保留动图与原始画质） */
export const BACKGROUND_KEEP_ORIGINAL_BYTES = 1536 * 1024;
/** 背景图：压缩时的最长边像素 */
export const BACKGROUND_MAX_EDGE = 2560;
/** 背景图：压缩后仍超过该体积则拒收 */
export const BACKGROUND_MAX_BYTES = 4 * 1024 * 1024;
/** 背景图：下载 / 选择的原图体积上限 */
export const BACKGROUND_SOURCE_MAX_BYTES = 30 * 1024 * 1024;
