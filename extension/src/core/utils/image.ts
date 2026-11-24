import { blobToDataUrl, normalizeFaviconBlob } from '../../../shared/favicon.js';
import {
  BACKGROUND_KEEP_ORIGINAL_BYTES,
  BACKGROUND_MAX_BYTES,
  BACKGROUND_MAX_EDGE,
} from '../config';

export function blobToDataURL(blob: Blob): Promise<string> {
  return blobToDataUrl(blob);
}

export function dataURLToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(String(dataUrl || ''));
  if (!m || !m[2]) throw new Error('invalid_data_url');
  const bin = atob(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] || 'application/octet-stream' });
}

/** 本地上传图标：小图原样保存，大图降采样到 128px（与在线抓取的图标同规格） */
const ICON_KEEP_ORIGINAL_BYTES = 32 * 1024;

/**
 * @throws Error message 可直接展示给用户
 */
export async function prepareIcon(blob: Blob): Promise<string> {
  if (!/^image\//i.test(blob.type)) throw new Error('请选择图片文件');
  if (blob.size <= ICON_KEEP_ORIGINAL_BYTES) return blobToDataURL(blob);
  const out = await normalizeFaviconBlob(blob);
  if (!out) throw new Error('无法处理该图片，请换一张较小的图片');
  return out;
}

/**
 * 背景图规范化：
 * - 不超过 1.5MB 的原图直接保存（保留 GIF 动图与原始画质）
 * - 更大的图片缩放到最长边 2560px 并以 WebP 编码；仍超过 4MB 则拒收
 *
 * 旧版本地上传不做任何体积控制，几十 MB 的原图以 base64 写入存储，
 * 拖慢每一次读写与跨标签页同步。
 * @throws Error message 可直接展示给用户
 */
export async function prepareBackground(blob: Blob): Promise<string> {
  if (!/^image\//i.test(blob.type)) throw new Error('请选择图片文件');
  if (blob.size <= BACKGROUND_KEEP_ORIGINAL_BYTES) return blobToDataURL(blob);

  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    throw new Error('无法解析该图片');
  }
  try {
    const scale = Math.min(1, BACKGROUND_MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法处理该图片');
    ctx.drawImage(bmp, 0, 0, w, h);
    for (const quality of [0.86, 0.75, 0.6]) {
      const out = await canvas.convertToBlob({ type: 'image/webp', quality });
      if (out.size <= BACKGROUND_MAX_BYTES) return blobToDataURL(out);
    }
    throw new Error('图片压缩后仍过大，请换一张图片');
  } finally {
    bmp.close();
  }
}
