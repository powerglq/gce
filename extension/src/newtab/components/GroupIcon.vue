<template>
  <svg
    class="gi"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(d, i) in paths" :key="i" :d="d" />
  </svg>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { GROUP_ICONS, resolveGroupIcon } from '../../core/groupIcons';

/** name：Group.icon 的存储值（兼容旧版 iconfont key） */
const props = defineProps<{ name?: string }>();
const paths = computed(() => GROUP_ICONS[resolveGroupIcon(props.name)]);
</script>
<style scoped>
/* 尺寸跟随父元素 font-size，颜色跟随 color */
.gi{ width:1em; height:1em; display:block; flex:none }
</style>
