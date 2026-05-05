<script setup lang="ts">
import { EffectTrigger } from '@arcadia-eternity/const'

defineProps<{
  id: string
  modelValue: string | string[]
  priority: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | string[]]
  'update:priority': [value: number]
}>()

const allTriggers = Object.values(EffectTrigger)
const triggerDisplayMap: Record<string, string> = {
  BeforeUseSkillCheck: '使用技能前检查',
  AfterUseSkillCheck: '使用技能后检查',
  BeforeHit: '命中前',
  OnHit: '命中时',
  AfterHit: '命中后',
  OnDamage: '造成伤害时',
  OnBeforeCalculateDamage: '计算伤害前',
  OnAfterCalculateDamage: '计算伤害后',
  OnBeforeDealDamage: '造成伤害前',
  OnBeHit: '被命中时',
  OnBeDamage: '受到伤害时',
  OnKill: '击杀时',
  OnBeKill: '被击杀时',
  OnFaint: '濒死时',
  OnSwitchIn: '上场时',
  OnSwitchOut: '下场时',
  OnBattleStart: '战斗开始时',
  OnTurnStart: '回合开始时',
  OnTurnEnd: '回合结束时',
  OnMarkCreated: '标记创建时',
  OnMarkRemoved: '标记移除时',
  OnStack: '堆叠时',
  OnStackBefore: '堆叠前',
  OnUseSkill: '使用技能时',
  OnBeforeUseSkill: '使用技能前',
  OnAfterUseSkill: '使用技能后',
  OnPropertyChange: '属性变化时',
}

function getDisplayLabel(trigger: string): string {
  return triggerDisplayMap[trigger] ?? trigger
}
</script>

<template>
  <div class="effect-header">
    <div class="identity-row">
      <span class="identity-icon">✨</span>
      <span class="identity-name">{{ id || '新效果' }}</span>
    </div>
    <div class="header-fields">
      <div class="field-group">
        <label class="field-label">触发器</label>
        <el-select
          :model-value="Array.isArray(modelValue) ? modelValue : [modelValue].filter(Boolean)"
          multiple
          filterable
          placeholder="选择触发器..."
          class="trigger-select"
          @update:model-value="(v: string[]) => emit('update:modelValue', v)"
        >
          <el-option v-for="trigger in allTriggers" :key="trigger" :label="getDisplayLabel(trigger)" :value="trigger" />
        </el-select>
      </div>
      <div class="field-group">
        <label class="field-label">优先级</label>
        <el-input-number
          :model-value="priority"
          :min="-100"
          :max="100"
          @update:model-value="(v: number | undefined) => emit('update:priority', v ?? 0)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.effect-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ae-border-subtle);
  background-color: var(--ae-bg-elevated);
  flex-shrink: 0;
}

.identity-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.identity-icon {
  font-size: 16px;
}

.identity-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ae-text-primary);
  font-family: monospace;
}

.header-fields {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.field-label {
  font-size: 11px;
  color: var(--ae-text-muted);
  text-transform: uppercase;
  font-weight: 500;
}

.trigger-select {
  min-width: 280px;
}
</style>
