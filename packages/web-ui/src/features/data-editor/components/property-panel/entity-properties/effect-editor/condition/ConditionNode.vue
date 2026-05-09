<script setup lang="ts">
import { computed } from 'vue'
import type { ConditionDSL, EffectDslFieldTypingRule, EvaluatorDSL, Value } from '@arcadia-eternity/schema'
import ConditionTreeEditor from './ConditionTreeEditor.vue'
import SelectorEditor from '../selector/SelectorEditor.vue'
import EvaluatorEditor from '../evaluator/EvaluatorEditor.vue'
import SlotSelectorValue from '../value/SlotSelectorValue.vue'
import {
  useEffectTyping,
  resolveStringEnumOptions,
  resolveEvaluatorValueTyping as resolveTyping,
} from '../composables/useEffectTyping'

const props = withDefaults(
  defineProps<{
    modelValue: ConditionDSL | undefined
    operatorType?: string
    field?: string
    fieldCategory?: 'selectorFields' | 'valueFields'
  }>(),
  {
    operatorType: undefined,
    field: undefined,
    fieldCategory: undefined,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: ConditionDSL | undefined]
}>()

const typing = useEffectTyping()

function getConditionType(): string | undefined {
  if (props.modelValue && typeof props.modelValue === 'object' && 'type' in props.modelValue) {
    return (props.modelValue as Record<string, unknown>).type as string | undefined
  }
  return undefined
}

const conditionSelectorFieldRule = computed((): EffectDslFieldTypingRule | undefined => {
  const condType = getConditionType()
  if (!condType) return undefined
  // Resolve the first selector field's rule for this condition type.
  // Currently only `evaluate` condition has selectorFields (target).
  const nodeTyping = typing.getNodeTyping('condition', condType)
  if (!nodeTyping?.selectorFields) return undefined
  const firstField = Object.keys(nodeTyping.selectorFields)[0]
  if (!firstField) return undefined
  return nodeTyping.selectorFields[firstField]
})

function getEvaluatorType(evModel: unknown): string | undefined {
  if (evModel && typeof evModel === 'object' && 'type' in evModel) {
    return (evModel as Record<string, unknown>).type as string | undefined
  }
  return undefined
}

function castEvaluator(v: ConditionDSL | EvaluatorDSL): EvaluatorDSL {
  if (typeof v === 'object' && v !== null && 'type' in v) {
    return v as EvaluatorDSL
  }
  return v as EvaluatorDSL
}

function resolveEvaluatorValueTyping(
  evModel: ConditionDSL | EvaluatorDSL,
  evField: string | undefined,
): {
  valueFilter?: string[]
  stringEnumOptions?: import('@arcadia-eternity/schema').StringEnumOption[]
} {
  const evType = getEvaluatorType(evModel)
  if (!evType || !evField) return {}

  let operatorStringEnumOptions: import('@arcadia-eternity/schema').StringEnumOption[] | undefined
  if (props.operatorType && props.field && props.fieldCategory) {
    const opRule = typing.getFieldTyping('operator', props.operatorType, props.field, props.fieldCategory)
    operatorStringEnumOptions = resolveStringEnumOptions(opRule)
  }

  return resolveTyping(evType, evField, operatorStringEnumOptions)
}
</script>

<template>
  <ConditionTreeEditor :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <template #selector="{ modelValue: sv, update: su }">
      <SelectorEditor :model-value="sv" :field-rule="conditionSelectorFieldRule" @update:model-value="su">
        <template #evaluator="{ modelValue: ev, update: eu }">
          <EvaluatorEditor :model-value="ev as EvaluatorDSL" @update:model-value="eu">
            <template #value="{ modelValue: evv, update: evu, field }">
              <SlotSelectorValue
                :model-value="evv"
                :allowed-types="resolveEvaluatorValueTyping(ev, field).valueFilter"
                :string-enum-options="resolveEvaluatorValueTyping(ev, field).stringEnumOptions"
                @update:model-value="v => evu(v as Value)"
              />
            </template>
          </EvaluatorEditor>
        </template>
        <template #value="{ modelValue: cv, update: cu }">
          <SlotSelectorValue :model-value="cv" @update:model-value="cu">
            <template #condition="{ modelValue: ccv, onUpdate: ccu }">
              <ConditionNode
                :model-value="ccv"
                :operator-type="operatorType"
                :field="field"
                :field-category="fieldCategory"
                @update:model-value="v => ccu(v as ConditionDSL)"
              />
            </template>
          </SlotSelectorValue>
        </template>
      </SelectorEditor>
    </template>

    <template #value="{ modelValue: vv, update: vu }">
      <SlotSelectorValue :model-value="vv" @update:model-value="v => vu(v as Value)" />
    </template>

    <template #condition="{ modelValue: cv, update: cu }">
      <EvaluatorEditor :model-value="castEvaluator(cv)" @update:model-value="cu">
        <template #value="{ modelValue: evv, update: evu, field }">
          <SlotSelectorValue
            :model-value="evv"
            :allowed-types="resolveEvaluatorValueTyping(cv, field).valueFilter"
            :string-enum-options="resolveEvaluatorValueTyping(cv, field).stringEnumOptions"
            @update:model-value="v => evu(v as Value)"
          />
        </template>
      </EvaluatorEditor>
    </template>
  </ConditionTreeEditor>
</template>

<script lang="ts">
export default { name: 'ConditionNode' }
</script>
