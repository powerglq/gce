import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// newtab 页面构建：产物输出到 extension/newtab-build/
// 该目录名与 extension/manifest.json 的 chrome_url_overrides 保持一致，
// 因此「直接加载 extension/ 目录」的开发方式与发布包都能正常工作。
// 各浏览器发布包由 scripts/build-browser.js 从这里复制生成。
export default defineConfig({
  plugins: [vue()],
  root: 'extension/src/newtab',
  base: './',
  build: {
    outDir: '../../newtab-build',
    emptyOutDir: true, // 每次构建前清空产物目录，避免旧 hash 文件堆积
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  },
});
