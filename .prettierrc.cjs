/**
 * 🎨 Prettier 配置 - 统一代码格式化
 */

module.exports = {
  // 基础配置
  semi: true,                    // 语句末尾分号
  singleQuote: true,            // 使用单引号
  quoteProps: 'as-needed',      // 对象属性引号
  trailingComma: 'es5',         // 尾随逗号
  tabWidth: 2,                  // 缩进宽度
  useTabs: false,               // 使用空格缩进
  
  // 换行配置
  printWidth: 100,              // 行宽限制
  endOfLine: 'lf',              // 换行符
  
  // Vue 特定配置
  vueIndentScriptAndStyle: false,
  
  // HTML 配置
  htmlWhitespaceSensitivity: 'css',
  
  // 括号配置
  bracketSpacing: true,         // 对象字面量空格
  bracketSameLine: false,       // 标签闭合位置
  arrowParens: 'avoid',         // 箭头函数参数括号
  
  // 文件覆盖配置
  overrides: [
    {
      files: '*.vue',
      options: {
        parser: 'vue'
      }
    },
    {
      files: '*.json',
      options: {
        parser: 'json',
        trailingComma: 'none'
      }
    },
    {
      files: '*.md',
      options: {
        parser: 'markdown',
        printWidth: 80,
        proseWrap: 'preserve'
      }
    }
  ]
};
