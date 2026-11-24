# 第三方声明

GCE启动器 包含或依赖以下第三方软件，它们按各自的许可证分发。

## 随扩展一起分发的代码

| 名称 | 位置 | 许可证 | 版权 |
|------|------|--------|------|
| [QRCode.js](https://github.com/davidshimjs/qrcodejs) | `extension/content/vendor/qrcode.min.js` | MIT | Copyright (c) 2012 davidshimjs |
| [Material Icons](https://github.com/google/material-design-icons) | `extension/content/floatingButtons.js` 中的按钮图标路径 | Apache License 2.0 | Copyright Google LLC |
| [Vue](https://github.com/vuejs/core) | 打包进新标签页 | MIT | Copyright (c) 2018-present, Yuxi (Evan) You |
| [Pinia](https://github.com/vuejs/pinia) | 打包进新标签页 | MIT | Copyright (c) 2019-present Eduardo San Martin Morote |
| [SortableJS](https://github.com/SortableJS/Sortable) | 打包进新标签页 | MIT | Copyright (c) 2019 All contributors to Sortable |

分组图标（`extension/src/core/groupIcons.ts`）与扩展图标为本项目原创，随本项目以 MIT 许可证发布。

QR Code 是 DENSO WAVE INCORPORATED 的注册商标。

开发与构建工具（Vite、Vitest、ESLint、TypeScript 等）只在开发时使用，不随扩展分发，其许可证见 `node_modules` 中各自的包。

## 许可证全文

- MIT License：<https://opensource.org/license/mit>
- Apache License 2.0：<https://www.apache.org/licenses/LICENSE-2.0>
