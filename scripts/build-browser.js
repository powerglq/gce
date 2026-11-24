#!/usr/bin/env node
/**
 * 发布包构建（Chrome / Edge）
 * 用法：
 *   node scripts/build-browser.js chrome
 *   node scripts/build-browser.js edge
 *   node scripts/build-browser.js all
 *
 * Edge 与 Chrome 使用同一份 manifest（新标签页覆盖键同为 chrome_url_overrides），
 * 区别只在输出目录，便于分别上传到两个商店。
 */
import { execSync } from 'child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = resolve(ROOT, 'extension');
/** vite 产物目录（与 manifest.json 中的 newtab 覆盖路径一致，可直接加载 extension/ 调试） */
const NEW_TAB_BUILD = resolve(EXT, 'newtab-build');

const TARGETS = {
  chrome: 'newtab-build-chrome',
  edge: 'newtab-build-edge',
};

/** 发布包需要的扩展文件（相对 extension/） */
const COPY = ['background.js', 'shared', 'content', 'icons'];

function build(name) {
  const outDir = resolve(EXT, TARGETS[name]);
  console.log(`\n🔧 构建 ${name} → extension/${TARGETS[name]}/`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  cpSync(NEW_TAB_BUILD, outDir, { recursive: true });
  for (const p of COPY) cpSync(resolve(EXT, p), resolve(outDir, p), { recursive: true });

  const manifest = JSON.parse(readFileSync(resolve(EXT, 'manifest.json'), 'utf-8'));
  // 发布包中 index.html 位于扩展根目录
  manifest.chrome_url_overrides = { newtab: 'index.html' };
  writeFileSync(resolve(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`✅ ${name} 构建完成`);
}

const target = process.argv[2] || 'all';
const names = target === 'all' ? Object.keys(TARGETS) : [target];
for (const n of names) {
  if (!TARGETS[n]) {
    console.error(`未知目标: ${n}，可选: ${Object.keys(TARGETS).join(', ')}, all`);
    process.exit(1);
  }
}
execSync('npx vite build', { cwd: ROOT, stdio: 'inherit' });
names.forEach(build);
