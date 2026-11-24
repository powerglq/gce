<template>
  <div
    class="add"
    title="添加链接"
    :style="addCardStyle"
    role="button"
    tabindex="0"
    aria-label="添加链接"
    @click="emit('add')"
    @keydown.enter.prevent="emit('add')"
    @keydown.space.prevent="emit('add')"
  >
    <span class="plus" aria-hidden="true">+</span>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useSettings } from '../../core/store/useSettings';

const emit = defineEmits<{ (e: 'add'): void }>();
const settings = useSettings();

const addCardStyle = computed(() => {
  const { iconPx, radius } = settings.settings;
  const size = Math.max(iconPx + 24, 64);
  return { width: `${size}px`, height: `${size}px`, borderRadius: `${radius}px` };
});
</script>
<style scoped>
.add{ display:flex; align-items:center; justify-content:center; background: var(--surface); border:1px solid var(--border); backdrop-filter: blur(6px); cursor:pointer; transition:transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out) }
.add:hover{ transform: translateY(-1px); box-shadow: var(--shadow) }
.add:focus-visible{ outline:2px solid var(--primary); outline-offset:2px }
.plus{ font-size:22px; color: var(--text); opacity: .85 }
</style>
