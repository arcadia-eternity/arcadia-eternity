<script setup lang="ts">
const props = defineProps<{
  modelValue: { consumesStacks?: number; tags?: string[] }
}>()

const emit = defineEmits<{
  'update:modelValue': [value: { consumesStacks?: number; tags?: string[] }]
}>()

function updateConsumesStacks(v: number | undefined) {
  emit('update:modelValue', { ...props.modelValue, consumesStacks: v ?? undefined })
}

function updateTags(v: string) {
  const tags = v
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  emit('update:modelValue', { ...props.modelValue, tags: tags.length > 0 ? tags : undefined })
}
</script>

<template>
  <div class="effect-footer">
    <div class="footer-fields">
      <div class="field-group">
        <label class="field-label">消耗堆叠</label>
        <el-input-number
          :model-value="modelValue.consumesStacks"
          :min="1"
          :max="999"
          controls-position="right"
          placeholder="不消耗"
          @update:model-value="updateConsumesStacks"
        />
      </div>
      <div class="field-group">
        <label class="field-label">标签</label>
        <el-input
          :model-value="(modelValue.tags ?? []).join(', ')"
          placeholder="逗号分隔"
          @update:model-value="updateTags"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.effect-footer {
  padding: 8px 16px;
  border-top: 1px solid var(--ae-border-subtle);
  flex-shrink: 0;
}

.footer-fields {
  display: flex;
  gap: 12px;
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
</style>
