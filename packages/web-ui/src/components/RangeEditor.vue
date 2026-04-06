<script setup lang="ts">
import { computed } from 'vue'
import { ElSwitch, ElInputNumber } from 'element-plus'

const props = defineProps<{
  value: unknown
}>()

const emit = defineEmits<{
  update: [value: unknown]
}>()

const isTuple = computed(() => Array.isArray(props.value) && props.value.length === 2)
const singleValue = computed(() => {
  if (typeof props.value === 'number') return props.value
  return undefined
})
const tupleMin = computed(() => {
  if (isTuple.value && typeof (props.value as number[])[0] === 'number') {
    return (props.value as number[])[0]
  }
  return 1
})
const tupleMax = computed(() => {
  if (isTuple.value && typeof (props.value as number[])[1] === 'number') {
    return (props.value as number[])[1]
  }
  return 1
})

const useRange = computed({
  get: () => isTuple.value,
  set: (val: boolean) => {
    if (val) {
      emit('update', [tupleMin.value, tupleMax.value])
    } else {
      emit('update', singleValue.value ?? 1)
    }
  },
})

function updateSingleValue(val: number | null | undefined) {
  emit('update', val ?? undefined)
}

function updateTupleMin(val: number | null | undefined) {
  emit('update', [val ?? 1, tupleMax.value])
}

function updateTupleMax(val: number | null | undefined) {
  emit('update', [tupleMin.value, val ?? 1])
}
</script>

<template>
  <div class="flex items-center gap-2">
    <ElSwitch v-model="useRange" size="small" />
    <span class="text-xs text-gray-500">范围</span>

    <template v-if="!useRange">
      <ElInputNumber
        :model-value="singleValue"
        :min="1"
        :step="1"
        controls-position="right"
        size="small"
        class="flex-1"
        @update:model-value="updateSingleValue"
      />
      <span class="text-xs text-gray-400">次</span>
    </template>

    <template v-else>
      <ElInputNumber
        :model-value="tupleMin"
        :min="1"
        :step="1"
        controls-position="right"
        size="small"
        class="flex-1"
        @update:model-value="updateTupleMin"
      />
      <span class="text-xs text-gray-400">-</span>
      <ElInputNumber
        :model-value="tupleMax"
        :min="1"
        :step="1"
        controls-position="right"
        size="small"
        class="flex-1"
        @update:model-value="updateTupleMax"
      />
      <span class="text-xs text-gray-400">次</span>
    </template>
  </div>
</template>
