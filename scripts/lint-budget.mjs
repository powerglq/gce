#!/usr/bin/env node
/**
 * Lint 警告预算（ratchet）
 *
 * 背景：本项目 `no-explicit-any` 等规则设为 warn，且历史存量较多。
 * 直接上 --max-warnings 0 会让 CI 立刻变红，无法渐进治理。
 * 这里采用「预算制」：把当前警告数记入 baseline.json，
 * 之后任何一次提交若使警告数上升，CI 即失败。
 * 治理过程中应主动下调 baseline（见 npm run lint:baseline）。
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASELINE = resolve(ROOT, 'lint-baseline.json');

function countProblems() {
  let out = '';
  try {
    out = execSync('npx eslint extension tests --ext .js,.ts,.vue --format json', {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    }).toString();
  } catch (err) {
    // eslint 发现问题时以非 0 退出，但 stdout 仍是完整的 JSON 结果
    if (!err.stdout) throw err;
    out = err.stdout.toString();
  }
  let errors = 0;
  let warnings = 0;
  for (const r of JSON.parse(out || '[]')) {
    errors += r.errorCount || 0;
    warnings += r.warningCount || 0;
  }
  return { errors, warnings };
}

const { errors, warnings } = countProblems();

if (errors > 0) {
  console.error(`❌ 存在 ${errors} 个 ESLint error（必须为 0）`);
  process.exit(1);
}

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify({ maxWarnings: warnings }, null, 2) + '\n');
  console.log(`✅ 已更新 lint 预算为 ${warnings}`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  writeFileSync(BASELINE, JSON.stringify({ maxWarnings: warnings }, null, 2) + '\n');
  console.log(`⚠️  未找到 lint-baseline.json，已以当前值 ${warnings} 创建`);
  process.exit(0);
}

const { maxWarnings } = JSON.parse(readFileSync(BASELINE, 'utf-8'));
if (warnings > maxWarnings) {
  console.error(`❌ Lint 警告数超预算：当前 ${warnings} > 预算 ${maxWarnings}`);
  console.error('   请修复新增警告，或在治理完成后下调预算：npm run lint:baseline');
  process.exit(1);
}

console.log(`✅ Lint 预算通过：${warnings} / ${maxWarnings} warnings，0 errors`);
