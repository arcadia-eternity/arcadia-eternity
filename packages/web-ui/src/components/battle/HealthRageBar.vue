<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import ModifiedValue from './ModifiedValue.vue'
import type { AttributeModifierInfo } from '@arcadia-eternity/const'
import { analyzeModifierType } from '@/utils/modifierStyles'
const props = withDefaults(
  defineProps<{
    current: number
    max: number
    rage?: number
    maxRage?: number
    reverse?: boolean
    currentHpModifierInfo?: AttributeModifierInfo
    maxHpModifierInfo?: AttributeModifierInfo
    rageModifierInfo?: AttributeModifierInfo
    maxRageModifierInfo?: AttributeModifierInfo
  }>(),
  { rage: 0, maxRage: 100, reverse: false },
)
const ratio = (value: number, max: number) => (max > 0 ? Math.min(1, Math.max(0, value / max)) : 0)
const health = computed(() => ratio(props.current, props.max))
const rageRatio = computed(() => ratio(props.rage, props.maxRage))
const trail = ref(health.value)
let timer: ReturnType<typeof setTimeout> | undefined
watch(health, (value, old) => {
  clearTimeout(timer)
  if (value >= old) trail.value = value
  else {
    trail.value = Math.max(trail.value, old)
    timer = setTimeout(() => {
      trail.value = value
    }, 450)
  }
})
onUnmounted(() => clearTimeout(timer))
const hpModifier = computed(() => analyzeModifierType(props.currentHpModifierInfo, 'currentHp'))
const rageModifier = computed(() => analyzeModifierType(props.rageModifierInfo, 'currentRage'))
</script>
<template>
  <div class="battle-bars" :class="{ 'battle-bars--reverse': reverse }">
    <div class="battle-bars__row">
      <span class="battle-bars__label">HP</span>
      <div
        class="battle-bars__track"
        role="meter"
        aria-label="生命值"
        :aria-valuenow="current"
        :aria-valuemin="0"
        :aria-valuemax="max"
        :data-modifier="hpModifier"
      >
        <div class="battle-bars__trail" :style="{ transform: `scaleX(${trail})` }"></div>
        <div
          class="battle-bars__fill"
          :class="{ 'battle-bars__fill--low': health < 0.25 }"
          :style="{ transform: `scaleX(${health})` }"
        ></div>
        <span class="battle-bars__value"
          ><ModifiedValue :value="current" :attribute-info="currentHpModifierInfo" size="sm" inline /> /
          <ModifiedValue :value="max" :attribute-info="maxHpModifierInfo" size="sm" inline
        /></span>
      </div>
    </div>
    <div class="battle-bars__row battle-bars__row--rage">
      <span class="battle-bars__label">怒</span>
      <div
        class="battle-bars__track"
        role="meter"
        aria-label="怒气"
        :aria-valuenow="rage"
        :aria-valuemin="0"
        :aria-valuemax="maxRage"
        :data-modifier="rageModifier"
      >
        <div class="battle-bars__fill battle-bars__fill--rage" :style="{ transform: `scaleX(${rageRatio})` }"></div>
        <span class="battle-bars__value"
          ><ModifiedValue :value="rage" :attribute-info="rageModifierInfo" size="sm" inline /> /
          <ModifiedValue :value="maxRage" :attribute-info="maxRageModifierInfo" size="sm" inline
        /></span>
      </div>
    </div>
  </div>
</template>
<style scoped>
.battle-bars {
  display: grid;
  gap: 5px;
  margin: 2px 0;
}
.battle-bars__row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.battle-bars__label {
  color: var(--battle-muted);
  font-size: 10px;
  width: 18px;
  flex: none;
}
.battle-bars__track {
  position: relative;
  overflow: hidden;
  flex: 1;
  height: 21px;
  background: transparent;
  clip-path: polygon(0 0, 100% 0, calc(100% - 6px) 100%, 0 100%);
}
.battle-bars__fill,
.battle-bars__trail {
  position: absolute;
  inset: 0;
  transform-origin: left;
  transition: transform 0.28s ease;
  background: var(--battle-hp);
}
.battle-bars__trail {
  background: var(--battle-gold);
  transition-duration: 0.5s;
}
.battle-bars__fill--low {
  background: var(--battle-danger);
}
.battle-bars__fill--rage {
  background: var(--battle-gold);
}
.battle-bars__value {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: #fff;
  text-shadow:
    0 1px 3px #000,
    0 0 4px #000;
}
.battle-bars__row--rage .battle-bars__track {
  height: 17px;
}
.battle-bars--reverse .battle-bars__fill,
.battle-bars--reverse .battle-bars__trail {
  transform-origin: right;
}
</style>
