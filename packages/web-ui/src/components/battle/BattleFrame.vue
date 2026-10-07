<script setup lang="ts">
import { useId } from 'vue'
import skillChrome from '@/assets/battle/skill-chrome.svg'
withDefaults(defineProps<{ accent?: 'cyan' | 'gold'; reverse?: boolean; variant?: 'panel' | 'skill' }>(), {
  accent: 'cyan',
  reverse: false,
  variant: 'panel',
})
const bevelId = `battle-bevel-${useId()}`
</script>

<template>
  <img
    v-if="variant === 'skill'"
    :src="skillChrome"
    class="battle-frame battle-frame--skill"
    alt=""
    aria-hidden="true"
  />
  <svg
    v-else
    class="battle-frame"
    :class="[`battle-frame--${accent}`, { 'battle-frame--reverse': reverse }]"
    viewBox="0 0 400 160"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <defs>
      <linearGradient :id="bevelId" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#effbff" />
        <stop offset="0.12" stop-color="#788a9c" />
        <stop offset="0.5" stop-color="#38495c" />
        <stop offset="1" stop-color="#c0d0da" />
      </linearGradient>
    </defs>
    <rect class="battle-frame__fill" x="2" y="2" width="396" height="156" rx="10" />
    <rect class="battle-frame__edge" x="2" y="2" width="396" height="156" rx="10" :stroke="`url(#${bevelId})`" />
    <rect class="battle-frame__detail" x="6" y="6" width="388" height="148" rx="7" />
  </svg>
</template>

<style scoped>
.battle-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  color: var(--battle-cyan, #66ffff);
}
.battle-frame--gold {
  color: var(--battle-gold, #f4ec8a);
}
.battle-frame--reverse {
  transform: scaleX(-1);
}
.battle-frame__fill {
  fill: var(--battle-panel, #0e1525);
  fill-opacity: 0.94;
}
.battle-frame__edge {
  fill: none;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}
.battle-frame__detail {
  fill: none;
  stroke: currentColor;
  stroke-width: 0.6;
  vector-effect: non-scaling-stroke;
  opacity: 0.35;
}
</style>
