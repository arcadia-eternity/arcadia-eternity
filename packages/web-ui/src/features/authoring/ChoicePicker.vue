<script setup lang="ts">
import { computed, ref } from 'vue'
const props = defineProps<{
  label: string
  options: { id: string; label: string; detail?: string; disabled?: boolean }[]
}>()
const emit = defineEmits<{ choose: [id: string]; cancel: [] }>()
const query = ref('')
const matches = computed(() =>
  props.options.filter(option =>
    `${option.label} ${option.id} ${option.detail ?? ''}`
      .toLocaleLowerCase()
      .includes(query.value.trim().toLocaleLowerCase()),
  ),
)
</script>
<template>
  <section class="choice-picker" :aria-label="label">
    <header>
      <strong>{{ label }}</strong
      ><button type="button" @click="emit('cancel')">收起</button>
    </header>
    <input v-model="query" type="search" :aria-label="`搜索${label}`" placeholder="输入名称或 ID 查找已有内容" />
    <p class="hint" aria-live="polite">{{ matches.length }} 个匹配结果</p>
    <ul>
      <li v-for="option in matches.slice(0, 40)" :key="option.id">
        <button type="button" :disabled="option.disabled" @click="emit('choose', option.id)">
          <strong>{{ option.label }}</strong
          ><small>{{ option.detail || option.id }}{{ option.disabled ? ' · 已关联' : '' }}</small>
        </button>
      </li>
    </ul>
    <p v-if="!matches.length" class="hint">没有匹配内容。可在外部编辑器添加内容，保存后这里会刷新。</p>
    <p v-if="matches.length > 40" class="hint">输入更具体的名称可缩小范围。</p>
  </section>
</template>
<style scoped>
.choice-picker {
  padding: 16px;
  border: 1px solid var(--author-border, #dce4dd);
  border-radius: 12px;
  background: var(--author-panel, #fff);
  margin: 12px 0;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px;
  border: 1px solid var(--author-border, #dce4dd);
  border-radius: 8px;
  background: var(--author-bg, #f8faf8);
  color: inherit;
}
ul {
  list-style: none;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 8px;
}
button {
  font: inherit;
  color: inherit;
  border: 1px solid var(--author-border, #dce4dd);
  background: var(--author-bg, #f8faf8);
  border-radius: 8px;
  padding: 8px 12px;
  text-align: left;
}
li button {
  width: 100%;
  min-height: 56px;
}
small {
  display: block;
  color: var(--author-muted, #647267);
  overflow-wrap: anywhere;
}
button:disabled {
  opacity: 0.5;
}
.hint {
  font-size: 12px;
  color: var(--author-muted, #647267);
}
</style>
