/// <reference types="vite/client" />

// 说明：这里刻意不再声明 `declare module '*.vue'`。
//
// 旧版有一个 DefineComponent<{}, {}, any> 的 shim，在 vue-tsc 下不仅多余，
// 还会把每个 SFC 的 props / emits / slots 全部降级为 any，
// 让「typecheck 通过」变成假象。移除后由 vue-tsc 直接解析 SFC 的真实类型。
