# 贡献指南

感谢你愿意改进 GCE启动器！

## 开发环境

- Node.js：版本见 [`.nvmrc`](.nvmrc)（使用 nvm 时执行 `nvm use`）
- 浏览器：Chrome 或 Edge

```bash
npm install
npm run setup:hooks   # 启用提交前检查（拦截私钥、打包产物等敏感文件）
npm run build
```

在 `chrome://extensions/` 开启「开发者模式」，加载 `extension/` 目录。修改代码后运行 `npm run build`，再在扩展卡片上点「刷新」。也可以用 `npm run dev`：它会监听源码变化自动构建，并启动一个独立配置的调试浏览器。

## 提交前

```bash
npm run check   # 类型检查 + Lint（0 error，警告不超预算）+ 单元测试
```

CI 会在每个 Pull Request 上运行同样的检查与构建，未通过的 PR 无法合并。

- **代码风格**：以 `.eslintrc.cjs` 与 `.prettierrc.cjs` 为准。Vue 模板中一个标签超过 3 个属性时，每个属性单独一行。
- **Lint 警告预算**：`lint-baseline.json` 记录允许的警告数，新代码不能增加警告。修掉旧警告后运行 `npm run lint:baseline` 把预算调低。
- **类型**：不要用 `as` 强转来掩盖类型不匹配，让类型定义与真实数据一致。
- **不留死代码**：只写当前有调用方的代码；删除功能时把相关样式、配置、测试一起删掉。
- **测试**：修复 bug 时先补一个能复现它的测试用例。
- **提交信息**：建议使用 `feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `chore:` 前缀。

## 项目结构

```
extension/
├── manifest.json
├── background.js          # Service Worker：数据迁移；悬浮按钮的唯一数据入口；收藏后补抓图标
├── content/
│   ├── floatingButtons.js # 网页悬浮按钮（closed Shadow DOM，样式与网页完全隔离）
│   └── vendor/            # 第三方代码（不做 lint / 格式化）
├── icons/
├── shared/                # newtab 页与 Service Worker 共用（纯 JS）
│   ├── model.js           # 默认值、字段清洗、URL 规范化（全项目唯一的判重依据）
│   ├── storage.js         # 存储层：多 key、跨上下文写锁、原子读-改-写、v1→v2 迁移
│   ├── favicon.js         # 图标 / 标题抓取（不依赖 DOM，Service Worker 中可用）
│   ├── sitePermission.js  # 可选的「访问所有网站」权限（开启悬浮按钮时申请）
│   ├── uid.js
│   └── log.js
└── src/
    ├── core/
    │   ├── store/         # Pinia：settings / bookmarks / engines / notebook / sharedItems
    │   ├── utils/         # backup、image、siteCache、iconShrink、bookmarkSearch、lunar、weather …
    │   ├── composables/   # useDraggablePanel（浮动面板拖拽 / 缩放）
    │   ├── groupIcons.ts  # 分组图标（内置 SVG）
    │   ├── types/model.ts # 数据类型（与 shared/model.js 同步修改）
    │   └── theme/         # 颜色令牌（深色 / 浅色）、主题切换、UI Kit
    └── newtab/            # App.vue、appInit.ts、components/
tests/                     # Vitest 单元测试
scripts/                   # 发布包构建、Lint 警告预算
```

## 数据存储

| key | 内容 |
|-----|------|
| `gce.settings` | 设置（含主题、小组件、Dock 列表、记事本字号字体、面板位置） |
| `gce.background` | 背景图 dataURL |
| `gce.fab` | 悬浮按钮开关与位置 |
| `gce.groups` / `gce.bookmarks` | 分组 / 书签 |
| `gce.engines` | 搜索引擎 |
| `gce.notebooks` | 笔记（图片本体在 IndexedDB `gce_db`） |
| `gce.sharedItems` | 收纳箱 |
| `gce.meta` | 存储结构版本 |
| `localGce` | v1 旧数据，迁移后保留作为回滚备份 |

**写入规则**：所有写操作都必须经过 `shared/storage.js` 的 `update(fields, mutator)`。它在跨上下文写锁内读取最新数据，由 mutator 计算补丁，清洗后只写回变化的 key，并维护两条不变量：书签所属分组必然存在、Dock 只包含存在的书签。不要把内存中的整份数据写回存储——多个标签页同时打开时，这会用旧数据覆盖其它页面刚写入的内容。

各页面通过 `chrome.storage.onChanged` 同步（`src/newtab/appInit.ts`）。网页中的悬浮按钮不能直接访问存储（`setAccessLevel: TRUSTED_CONTEXTS`），通过消息由 Service Worker 代办。

**修改数据结构时**，需要同步修改：`shared/model.js`（默认值与清洗）、`src/core/types/model.ts`（类型）、`src/core/utils/backup.ts`（导入导出），并补充 `tests/` 中的用例。备份文件格式是对外契约（`tests/backup.format.test.js`），不能做不兼容的修改。

## 发布

1. 更新 `package.json` 与 `extension/manifest.json` 中的版本号，并在 `CHANGELOG.md` 中记录变更
2. `npm run build:all`
3. 分别打包 `extension/newtab-build-chrome/` 与 `extension/newtab-build-edge/` 上传到商店

签名私钥（`.pem`）绝不能提交到仓库，`.gitignore` 与提交前检查都会拦截。
