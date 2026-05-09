<script setup lang="ts">
import type { Value, StringEnumOption } from '@arcadia-eternity/schema'
import SelectorBuilder from './SelectorBuilder.vue'
import ValueEditor from './ValueEditor.vue'

const props = defineProps<{
  modelValue: unknown
  expectedValueType?: 'number' | 'string' | 'boolean'
  allowedTypes?: string[]
  stringEnumOptions?: StringEnumOption[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: unknown]
}>()

function castValue(v: unknown): Value {
  return v as unknown as Value
}
</script>

<template>
  <ValueEditor
    :model-value="castValue(modelValue)"
    :allowed-types="props.allowedTypes"
    :string-enum-options="props.stringEnumOptions"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #selector="{ modelValue: dsv, update: dsu }">
      <SelectorBuilder :model-value="dsv" :expected-value-type="props.expectedValueType" @update:model-value="dsu">
        <template #value="{ modelValue: dcv, update: dcu }">
          <ValueEditor :model-value="castValue(dcv)" @update:model-value="dcu" />
        </template>
      </SelectorBuilder>
    </template>
    <template #condition="condProps">
      <slot name="condition" v-bind="condProps" />
    </template>
  </ValueEditor>
</template>
