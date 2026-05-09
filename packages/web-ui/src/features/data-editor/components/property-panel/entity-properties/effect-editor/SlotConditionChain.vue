<script setup lang="ts">
import type { ConditionDSL, EvaluatorDSL, Value } from '@arcadia-eternity/schema'
import ConditionTreeEditor from './ConditionTreeEditor.vue'
import SelectorEditor from './SelectorEditor.vue'
import EvaluatorEditor from './EvaluatorEditor.vue'
import SlotSelectorValue from './SlotSelectorValue.vue'

defineProps<{
  modelValue: ConditionDSL | undefined
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ConditionDSL | undefined]
}>()

function castEvaluator(v: ConditionDSL | EvaluatorDSL): EvaluatorDSL {
  if (typeof v === 'object' && v !== null && 'type' in v) {
    return v as EvaluatorDSL
  }
  console.warn('castEvaluator: unexpected value type, falling back to cast', v)
  return v as EvaluatorDSL
}

function castValue(v: Value): Value {
  return v
}
</script>

<template>
  <ConditionTreeEditor :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <template #selector="{ modelValue: sv, update: su }">
      <slot name="selector" :model-value="sv" :update="su">
        <SelectorEditor :model-value="sv" @update:model-value="su" />
      </slot>
    </template>

    <template #value="{ modelValue: vv, update: vu }">
      <slot name="value" :model-value="vv" :update="vu">
        <SlotSelectorValue :model-value="vv" @update:model-value="v => vu(castValue(v))" />
      </slot>
    </template>

    <template #condition="{ modelValue: cv, update: cu }">
      <slot name="condition" :model-value="cv" :update="cu">
        <EvaluatorEditor :model-value="castEvaluator(cv)" @update:model-value="cu">
          <template #value="{ modelValue: vv, update: vu }">
            <SlotSelectorValue :model-value="vv" @update:model-value="v => vu(castValue(v))" />
          </template>
        </EvaluatorEditor>
      </slot>
    </template>
  </ConditionTreeEditor>
</template>
