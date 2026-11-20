<script setup lang="ts">
import { ElButton, ElSelectV2 } from 'element-plus'
import { computed, nextTick, onMounted, ref } from 'vue'
const props = defineProps<{
  label: string
  options: { id: string; label: string; detail?: string; disabled?: boolean }[]
}>()
const emit = defineEmits<{ choose: [id: string]; cancel: [] }>()
const picker = ref<InstanceType<typeof ElSelectV2>>()
onMounted(async () => {
  await nextTick()
  picker.value?.focus()
})
const query = ref('')
function search(value: string) {
  query.value = value
}
const matches = computed(() =>
  props.options.filter(option =>
    `${option.label} ${option.id} ${option.detail ?? ''}`
      .toLocaleLowerCase()
      .includes(query.value.trim().toLocaleLowerCase()),
  ),
)
</script>
<template>
  <section class="choice-picker grid gap-2 my-3" :aria-label="label">
    <div class="flex items-center gap-2">
      <ElSelectV2
        ref="picker"
        automatic-dropdown
        default-first-option
        :model-value="undefined"
        :options="matches"
        :props="{ value: 'id', label: 'label', disabled: 'disabled' }"
        filterable
        :filter-method="search"
        :aria-label="label"
        :placeholder="label"
        no-data-text="无匹配内容"
        no-match-text="无匹配内容"
        :item-height="48"
        @update:model-value="emit('choose', $event)"
      >
        <template #default="{ item }"
          ><div class="leading-tight">
            <strong>{{ item.label }}</strong
            ><small class="block truncate">{{ item.detail || item.id }}{{ item.disabled ? ' · 已关联' : '' }}</small>
          </div></template
        >
      </ElSelectV2>
      <ElButton @click="emit('cancel')">收起</ElButton>
    </div>
  </section>
</template>
