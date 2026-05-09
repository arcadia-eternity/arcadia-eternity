<script setup lang="ts">
import type { Value, StringEnumOption } from '@arcadia-eternity/schema'
import SelectorEditor from './SelectorEditor.vue'
import ValueEditor from './ValueEditor.vue'

const props = defineProps<{
  modelValue: Value
  expectedValueType?: 'number' | 'string' | 'boolean'
  allowedTypes?: string[]
  stringEnumOptions?: StringEnumOption[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Value]
}>()
</script>

<template>
  <ValueEditor
    :model-value="props.modelValue"
    :allowed-types="props.allowedTypes"
    :string-enum-options="props.stringEnumOptions"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #selector="{ modelValue: dsv, update: dsu }">
      <SelectorEditor :model-value="dsv" :expected-value-type="props.expectedValueType" @update:model-value="dsu">
        <template #value="{ modelValue: dcv, update: dcu }">
          <ValueEditor :model-value="dcv" @update:model-value="dcu" />
        </template>
      </SelectorEditor>
    </template>
    <template #condition="condProps">
      <slot name="condition" v-bind="condProps" />
    </template>
  </ValueEditor>
</template>
