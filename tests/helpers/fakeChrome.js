/**
 * 测试用 chrome.* 内存实现
 * - storage.local：同时支持回调与 Promise 两种调用方式，可注入读 / 写失败
 * - storage.onChanged：写入后同步派发变更
 */
export function installFakeChrome() {
  const data = new Map();
  const listeners = new Set();
  const state = { data, failGet: 0, failSet: 0, setCalls: [] };
  const clone = (v) => (v === undefined ? undefined : structuredClone(v));

  /** 把回调式实现包装成「有回调走回调，无回调返回 Promise」 */
  const api = (impl) => (arg, cb) => {
    if (typeof cb === 'function') return impl(arg, cb);
    return new Promise((resolve, reject) =>
      impl(arg, (res) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(res);
      })
    );
  };

  /** 模拟 chrome 在回调期间设置 runtime.lastError */
  const fail = (cb, message, value) => {
    chrome.runtime.lastError = { message };
    try {
      cb(value);
    } finally {
      chrome.runtime.lastError = undefined;
    }
  };

  const chrome = {
    runtime: { id: 'test-ext', lastError: undefined, getManifest: () => ({ version: '0.0.0' }) },
    storage: {
      onChanged: {
        addListener: (f) => listeners.add(f),
        removeListener: (f) => listeners.delete(f),
      },
      local: {
        get: api((keys, cb) => {
          if (state.failGet > 0) {
            state.failGet--;
            return fail(cb, 'READ_FAIL', {});
          }
          const list = keys == null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of list) if (data.has(k)) out[k] = clone(data.get(k));
          cb(out);
        }),
        set: api((items, cb) => {
          state.setCalls.push(Object.keys(items));
          if (state.failSet > 0) {
            state.failSet--;
            return fail(cb, 'QUOTA_BYTES quota exceeded');
          }
          const changes = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { oldValue: clone(data.get(k)), newValue: clone(v) };
            data.set(k, clone(v));
          }
          cb();
          for (const l of listeners) l(changes, 'local');
        }),
        remove: api((keys, cb) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
          cb();
        }),
      },
    },
  };
  globalThis.chrome = chrome;
  return state;
}
