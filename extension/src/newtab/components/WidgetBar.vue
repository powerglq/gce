<template>
  <div class="widgets">
    <div v-if="w.clock" class="clock">{{ timeText }}</div>
    <div v-if="w.date || w.lunar || w.weather" class="info">
      <div v-if="w.date || (w.lunar && lunarText)" class="line">
        <span v-if="w.date">{{ dateText }}</span>
        <span v-if="w.lunar && lunarText">{{ lunarText }}</span>
      </div>
      <div v-if="w.weather" class="line weather" :title="weatherTitle">{{ weatherLine }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useSettings } from '../../core/store/useSettings';
import { LOGW } from '../../../shared/log.js';
import { formatLunar } from '../../core/utils/lunar';
import { getWeather, weatherText, WEATHER_TTL_MS } from '../../core/utils/weather';
import type { WeatherNow } from '../../core/utils/weather';

const WEATHER_SOURCE = '天气数据：Open-Meteo.com（CC BY 4.0）';

const settings = useSettings();
/** 是否显示整个组件由 App.vue 决定（它还要据此调整搜索框布局） */
const w = computed(() => settings.settings.widgets);

// ============ 时间：在每分钟开始时刷新 ============

const now = ref(new Date());
let tickTimer = 0;
function tick() {
  window.clearTimeout(tickTimer);
  now.value = new Date();
  tickTimer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
}

const timeFmt = computed(
  () => new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: !w.value.clock24 })
);
const dateFmt = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
const timeText = computed(() => timeFmt.value.format(now.value));
const dateText = computed(() => dateFmt.format(now.value));
const lunarText = computed(() => formatLunar(now.value));

// ============ 天气 ============

const weather = ref<WeatherNow | null>(null);
const weatherError = ref('');
let weatherTimer = 0;

async function loadWeather() {
  window.clearTimeout(weatherTimer);
  const city = w.value.city;
  if (!w.value.weather || !city) return;
  try {
    weather.value = await getWeather(city);
    weatherError.value = '';
  } catch (e) {
    weatherError.value = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    LOGW('WEATHER', '获取天气失败', e);
  }
  weatherTimer = window.setTimeout(() => void loadWeather(), WEATHER_TTL_MS);
}

const weatherTitle = computed(() => (weatherError.value ? `${weatherError.value}\n${WEATHER_SOURCE}` : WEATHER_SOURCE));

const weatherLine = computed(() => {
  const city = w.value.city;
  if (!city) return '天气：请在 设置 → 小组件 中选择城市';
  if (weather.value) return `${city.name} ${weatherText(weather.value.code)} ${Math.round(weather.value.temp)}°C`;
  return weatherError.value ? `${city.name} 天气获取失败` : `${city.name} 天气加载中…`;
});

watch(
  () => [w.value.weather, w.value.city?.lat, w.value.city?.lon],
  () => {
    weather.value = null;
    void loadWeather();
  }
);

/** 标签页在后台时定时器会被浏览器节流，回到前台时立即刷新 */
function onVisible() {
  if (document.visibilityState !== 'visible') return;
  tick();
  void loadWeather();
}

onMounted(() => {
  tick();
  void loadWeather();
  document.addEventListener('visibilitychange', onVisible);
});
onBeforeUnmount(() => {
  window.clearTimeout(tickTimer);
  window.clearTimeout(weatherTimer);
  document.removeEventListener('visibilitychange', onVisible);
});
</script>

<style scoped>
/* 与搜索框并排：字号克制，避免页面上方显得稀松 */
.widgets{ display:flex; align-items:center; gap:12px; flex:none; color:var(--text); text-shadow:0 1px 3px rgb(var(--paper) / .6); user-select:none; white-space:nowrap }
.clock{ font-size:30px; font-weight:300; line-height:1; font-variant-numeric:tabular-nums }
.info{ display:flex; flex-direction:column; gap:3px; font-size:12px; line-height:1.3; opacity:.88 }
.line > span + span::before{ content:'·'; margin:0 6px; opacity:.6 }
</style>
