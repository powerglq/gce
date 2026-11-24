import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import '../core/theme/tokens.css';
// UI Kit：浮动面板与控件的统一方案，新增面板/控件时复用这里的类
import '../core/theme/panel.css';
import '../core/theme/controls.css';
import { applyCachedTheme } from '../core/theme/theme';

applyCachedTheme();

createApp(App).use(createPinia()).mount('#app');
