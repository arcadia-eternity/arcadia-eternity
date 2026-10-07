<script setup lang="ts">
defineProps<{ name: 'fight' | 'switch' | 'wait' | 'flag' | 'log' | 'fullscreen' | 'training' | 'motion' | 'shield' }>()
const paths = {
  fight: 'M4 3l7 3 7 12-3 3L4 10V3zm16 0-7 3-7 12 3 3 11-11V3M3 17l4 4m10-4 4 4',
  switch: 'M4 8h15l-4-4m4 4-4 4M20 16H5l4 4m-4-4 4-4',
  wait: 'M8 4v16M16 4v16',
  flag: 'M5 21V3h14l-3 5 3 5H5',
  log: 'M5 3h14v18H5V3m4 5h6m-6 4h6m-6 4h4',
  fullscreen: 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6',
  training: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8m0 3v2',
  motion: 'M3 12h4l3-7 4 14 3-7h4',
  shield: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4m-4 9 3 3 5-6',
}
</script>
<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="battle-glyph"
  >
    <path :d="paths[name]" />
  </svg>
</template>
<style scoped>
.battle-glyph {
  width: 20px;
  height: 20px;
  flex: none;
}
</style>
