/**
 * 存储层的 TypeScript 封装：唯一实现位于 shared/storage.js（newtab 页与 background SW 共用）。
 * 这里补上类型，并提供统一的错误提示。
 */
import * as shared from '../../../shared/storage.js';
import type { StoreData, StoreField } from '../types/model';
import { toast } from '../utils/feedback';

export const UserError = shared.UserError;
export const pickChanges = shared.pickChanges;

/** 依赖字段：读写 bookmarks 时存储层会一并读取 groups 与 settings */
type WithDeps<F extends StoreField> = F | (F extends 'bookmarks' ? 'groups' | 'settings' : never);

export type Snapshot<F extends StoreField> = Pick<StoreData, WithDeps<F>>;

export function read<F extends StoreField>(fields?: F[]): Promise<Snapshot<F>> {
  return shared.read(fields) as Promise<Snapshot<F>>;
}

/**
 * 原子读-改-写：mutator 基于锁内最新数据计算补丁，只写回返回的字段。
 * 抛出 UserError 表示业务校验失败（不写入）。
 */
export function update<F extends StoreField>(
  fields: F[],
  mutator: (
    cur: Snapshot<F>
  ) => Partial<Snapshot<F>> | void | Promise<Partial<Snapshot<F>> | void>
): Promise<Snapshot<F>> {
  return shared.update(fields, mutator as never) as Promise<Snapshot<F>>;
}

export function decodeFields(
  raw: Partial<Record<StoreField, unknown>>,
  fields: StoreField[],
  ctx: { groups?: StoreData['groups'] } = {}
): Partial<StoreData> {
  return shared.decodeFields(raw as Record<string, unknown>, fields, ctx) as Partial<StoreData>;
}

export function isUserError(err: unknown): err is InstanceType<typeof shared.UserError> {
  return err instanceof shared.UserError;
}

/** 把错误转换为面向用户的提示文案 */
export function errorMessage(err: unknown, fallback = '⚠️ 本地保存失败，请重试'): string {
  if (isUserError(err)) return err.message;
  const msg = String((err as { message?: unknown })?.message ?? err ?? '');
  if (/quota|exceed|too large/i.test(msg)) return '⚠️ 本地存储空间不足，请删除部分背景图或收藏后重试';
  return fallback;
}

/**
 * 统一错误提示：业务错误直接展示；存储故障 10 秒内只提示一次，避免连续失败刷屏
 */
let lastStorageToastAt = 0;
export function notifyError(err: unknown, fallback?: string): void {
  if (!isUserError(err)) {
    console.error('[GCE]', err);
    const now = Date.now();
    if (now - lastStorageToastAt < 10000) return;
    lastStorageToastAt = now;
  }
  toast(errorMessage(err, fallback), { type: isUserError(err) ? 'warning' : 'error' });
}

/** 操作成功提示（节流，避免连续操作刷屏） */
let lastSavedToastAt = 0;
export function confirmSaved(message = '已保存', minIntervalMs = 1500): void {
  const now = Date.now();
  if (now - lastSavedToastAt < minIntervalMs) return;
  lastSavedToastAt = now;
  toast(message, { type: 'success' });
}
