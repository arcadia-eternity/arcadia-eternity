<script setup lang="ts">
import { computed } from 'vue'
import ModifiedValue from './ModifiedValue.vue'
import BattleBarNumber from './BattleBarNumber.vue'
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
const healthColor = computed(() => `hsl(${health.value * 120}, 100%, 45%)`)
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
        <div class="battle-bars__visual">
          <div
            class="battle-bars__fill"
            :style="{ transform: `scaleX(${health})`, backgroundColor: healthColor }"
          ></div>
        </div>
        <span class="battle-bars__value">
          <ModifiedValue :value="current" :attribute-info="currentHpModifierInfo" size="sm" inline>
            <template #default="{ value }"><BattleBarNumber :value="value" kind="hp" /></template>
          </ModifiedValue>
          <BattleBarNumber value="/" kind="hp" class="battle-bars__slash" />
          <ModifiedValue :value="max" :attribute-info="maxHpModifierInfo" size="sm" inline>
            <template #default="{ value }"><BattleBarNumber :value="value" kind="hp" /></template>
          </ModifiedValue>
        </span>
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
        <div class="battle-bars__visual">
          <div class="battle-bars__fill battle-bars__fill--rage" :style="{ transform: `scaleX(${rageRatio})` }"></div>
        </div>
        <span class="battle-bars__value">
          <ModifiedValue :value="rage" :attribute-info="rageModifierInfo" size="sm" inline>
            <template #default="{ value }"><BattleBarNumber :value="value" kind="rage" /></template>
          </ModifiedValue>
          <BattleBarNumber value="/" kind="rage" class="battle-bars__slash" />
          <ModifiedValue :value="maxRage" :attribute-info="maxRageModifierInfo" size="sm" inline>
            <template #default="{ value }"><BattleBarNumber :value="value" kind="rage" /></template>
          </ModifiedValue>
        </span>
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
  color: var(--battle-hp);
  font-size: 16px;
  font-weight: 600;
  text-align: center;
  width: 18px;
  flex: none;
}
.battle-bars__track {
  position: relative;
  overflow: visible;
  flex: 1;
  height: 21px;
  background: transparent;
}
.battle-bars__visual {
  position: absolute;
  inset: 0;
  overflow: hidden;
  clip-path: polygon(0 0, 100% 0, calc(100% - 6px) 100%, 0 100%);
}
.battle-bars__fill {
  position: absolute;
  inset: 0;
  transform-origin: left;
  transition:
    transform 0.18s linear,
    background-color 0.18s linear;
  background-image: linear-gradient(#ffffff55, #ffffff00 55%, #00000022);
}
.battle-bars__fill--rage {
  background: linear-gradient(#ffbc62, #ff4a24 50%, #b81e13);
}
.battle-bars__value {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 12px minmax(0, 1fr);
  align-items: center;
  column-gap: 4px;
  font-size: 16px;
  line-height: 1;
  font-style: italic;
  font-weight: 800;
  letter-spacing: 1px;
  color: #fff;
}
.battle-bars__value > :first-child {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  text-align: right;
}
.battle-bars__value > :last-child {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  text-align: left;
}
.battle-bars__value :deep(span) {
  font-size: inherit;
  line-height: 1;
}
.battle-bars__slash {
  text-align: center;
}
.battle-bars__row--rage .battle-bars__value {
  transform: translateY(-1px);
}
.battle-bars__row--rage .battle-bars__label {
  color: #ff9b4c;
}
.battle-bars--reverse .battle-bars__row {
  flex-direction: row-reverse;
}
.battle-bars--reverse .battle-bars__visual {
  clip-path: polygon(6px 0, 100% 0, 100% 100%, 0 100%);
}
.battle-bars__row--rage .battle-bars__track {
  height: 17px;
}
.battle-bars--reverse .battle-bars__fill {
  transform-origin: right;
}
</style>
