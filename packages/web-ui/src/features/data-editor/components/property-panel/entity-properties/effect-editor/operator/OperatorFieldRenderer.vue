<script setup lang="ts">
import { computed } from 'vue'
import type { OperatorFieldDef } from '../constants/operatorFieldConfig'

const props = defineProps<{
  field: OperatorFieldDef
  model: Record<string, unknown>
  fieldHint: (fieldName: string) => string | undefined
}>()

const emit = defineEmits<{
  'update:field': [fieldName: string, value: unknown]
}>()

const resolvedKey = computed(() => props.field.slotField ?? props.field.key)

const hint = computed(() => {
  const fn = props.field.hintField ?? props.field.key
  return props.fieldHint(fn)
})

// ── Slot props ────────────────────────────────────────────────────────────────

const slotProps = computed(() => ({
  modelValue: props.model[resolvedKey.value],
  field: resolvedKey.value,
  update: (v: unknown) => emit('update:field', resolvedKey.value, v),
}))

// ── Inline component bindings ────────────────────────────────────────────────

const componentKey = computed(() => props.field.componentModelBind ?? props.field.key)

const selectValue = computed(
  () => props.model[componentKey.value] as string | number | boolean | Record<string, unknown> | undefined,
)
const switchValue = computed(() => !!props.model[componentKey.value])
const inputNumberValue = computed(() => Number(props.model[componentKey.value] ?? 0))

function onSelectUpdate(v: unknown) {
  emit('update:field', componentKey.value, v)
}
function onSwitchUpdate(v: unknown) {
  emit('update:field', componentKey.value, v)
}
function onInputNumberUpdate(v: number | undefined) {
  emit('update:field', componentKey.value, v ?? 0)
}

const componentPlaceholder = computed(() => {
  if (props.field.component === 'el-select') return `选择${props.field.label}`
  return undefined
})
</script>

<template>
  <div class="op-field">
    <el-tooltip v-if="hint" :content="hint" placement="top" effect="dark">
      <label class="op-field-label">{{ field.label }}</label>
    </el-tooltip>
    <label v-else class="op-field-label">{{ field.label }}</label>

    <!-- Slot rendering (no inline component) -->
    <template v-if="field.component === undefined">
      <slot
        :name="field.slotName"
        :model-value="slotProps.modelValue"
        :field="slotProps.field"
        :update="slotProps.update"
      />
    </template>

    <!-- el-select -->
    <el-select
      v-else-if="field.component === 'el-select'"
      :model-value="selectValue"
      :placeholder="componentPlaceholder"
      clearable
      class="w-full"
      @update:model-value="onSelectUpdate"
    >
      <el-option v-for="opt in field.componentOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
    </el-select>

    <!-- el-switch -->
    <el-switch
      v-else-if="field.component === 'el-switch'"
      :model-value="switchValue"
      @update:model-value="onSwitchUpdate"
    />

    <!-- el-input-number -->
    <el-input-number
      v-else-if="field.component === 'el-input-number'"
      :model-value="inputNumberValue"
      v-bind="field.componentProps ?? {}"
      @update:model-value="onInputNumberUpdate"
    />
  </div>
</template>

<style scoped>
.op-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.op-field-label {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  font-weight: 500;
}
</style>
