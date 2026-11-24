/**
 * 🔧 ESLint 配置 - GCE 项目代码规范
 * 统一代码风格，提升代码质量和团队协作效率
 */

module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    webextensions: true,
    node: true
  },
  extends: [
    'eslint:recommended',
    'plugin:vue/vue3-recommended',
    'plugin:@typescript-eslint/recommended',
    // 必须放在最后：关闭所有与 Prettier 冲突的排版规则。
    // 过去 indent/quotes/semi/comma-dangle 与 Prettier 的 trailingComma:'es5'
    // 要求相反（多行函数调用尾逗号），导致 `npm run format` 之后 lint 必然报错。
    'prettier'
  ],
  parser: 'vue-eslint-parser',
  parserOptions: {
    ecmaVersion: 2022,
    parser: '@typescript-eslint/parser',
    sourceType: 'module'
  },
  plugins: [
    '@typescript-eslint',
    'vue'
  ],
  rules: {
    // 🎯 核心规范
    // 注意：排版类规则（indent/quotes/semi/comma-dangle/space-before-function-paren）
    // 全部交给 Prettier，ESLint 只管语义与最佳实践，避免两套格式化器互相打架。
    'no-console': 'off', // 错误路径与日志工具中会使用 console
    'no-debugger': 'warn',
    // 未使用变量由 TypeScript 的 noUnusedLocals/noUnusedParameters 负责
    // （ESLint 的 no-unused-vars 不检查 export，而本项目大量是未使用的 export）
    'no-unused-vars': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }], // 允许空 catch（静默容错）
    
    // 🔧 TypeScript 规范
    '@typescript-eslint/no-unused-vars': ['error', { 
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_' 
    }],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-non-null-assertion': 'warn',
    
    // 🎨 Vue 规范  
    'vue/max-attributes-per-line': ['error', {
      singleline: 3,
      multiline: 1
    }],
    'vue/multiline-html-element-content-newline': 'off',
    'vue/singleline-html-element-content-newline': 'off',
    'vue/html-self-closing': ['error', {
      html: {
        void: 'always',
        normal: 'never',
        component: 'always'
      }
    }],
    'vue/component-definition-name-casing': ['error', 'PascalCase'],
    'vue/prop-name-casing': ['error', 'camelCase'],
    
    // 🚀 最佳实践
    'prefer-const': 'error',
    'no-var': 'error',
    'object-shorthand': 'error',
    'prefer-template': 'error',
    'prefer-arrow-callback': 'error',
    
    // 🛡️ 安全规范
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-script-url': 'error',
    'no-alert': 'warn'
  },
  overrides: [
    {
      files: ['*.js'],
      rules: {
        '@typescript-eslint/no-var-requires': 'off'
      }
    },
    {
      files: ['*.vue'],
      rules: {
        'vue/multi-word-component-names': 'off'
      }
    },
    // 测试文件：允许更宽松的断言风格
    {
      files: ['tests/**/*.js'],
      rules: {
        'no-undef': 'off',
        // 用例里的 javascript: 地址是「必须被拒绝」的恶意输入，不是被执行的代码
        'no-script-url': 'off',
        // 用例中用 defineComponent 定义临时宿主组件来测试 composable
        'vue/one-component-per-file': 'off'
      }
    }
  ],
  globals: {
    chrome: 'readonly'
  }
};
