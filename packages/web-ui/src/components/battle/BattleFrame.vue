<script setup lang="ts">
withDefaults(defineProps<{ accent?: 'cyan' | 'gold'; reverse?: boolean }>(), { accent: 'cyan', reverse: false })
</script>

<template>
  <svg
    class="battle-frame"
    :class="[`battle-frame--${accent}`, { 'battle-frame--reverse': reverse }]"
    viewBox="0 0 400 160"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <path class="battle-frame__fill" d="M16 1H399V143L383 159H1V17Z" />
    <path class="battle-frame__edge" d="M16 1H399V143L383 159H1V17Z" />
    <path class="battle-frame__rail" d="M22 7H116M284 153H378L393 138" />
    <path class="battle-frame__detail" d="M7 32V21L21 7M372 147H383L393 137" />
  </svg>
</template>

<style scoped>
.battle-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  color: var(--battle-cyan, #66d9ed);
}
.battle-frame--gold {
  color: var(--battle-gold, #f4c56a);
}
.battle-frame--reverse {
  transform: scaleX(-1);
}
.battle-frame__fill {
  fill: var(--battle-panel, #0c1b2a);
  fill-opacity: 0.94;
}
.battle-frame__edge {
  fill: none;
  stroke: var(--battle-line, #365368);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.battle-frame__rail {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
  opacity: 0.7;
}
.battle-frame__detail {
  fill: none;
  stroke: currentColor;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
  opacity: 0.4;
}
</style>
