<template>
  <!-- 在表格单元格中使用 -->
  <div class="complex-array-editor">
    <!-- 展示模式 -->
    <div v-if="!isEditing" @click="startEdit">
      <ArrayTagCell :items="modelValue" />
      <el-button type="text" size="small" icon="Plus" class="ml-2" />
    </div>

    <!-- 编辑模式 -->
    <div v-else class="edit-container">
      <el-select v-model="tempValue" multiple filterable allow-create :reserve-keyword="false" @change="handleChange">
        <el-option v-for="item in availableOptions" :key="item.id" :label="item.name" :value="item.id" />
      </el-select>
      <div class="edit-actions">
        <el-button type="primary" size="small" @click="confirmEdit">✓</el-button>
        <el-button type="danger" size="small" @click="cancelEdit">✕</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGameDataStore } from '@/stores/gameData'

const props = defineProps<{
  modelValue: string[]
  type: 'skill' | 'ability' | 'emblem'
}>()

const emit = defineEmits(['update:modelValue'])

const gameData = useGameDataStore()
const isEditing = ref(false)
const tempValue = ref([...props.modelValue])

const availableOptions = computed(() => {
  switch (props.type) {
    case 'skill':
      return gameData.skills
    case 'ability':
      return gameData.marks
    case 'emblem':
      return gameData.marks
    default:
      return []
  }
})

const startEdit = () => {
  isEditing.value = true
  tempValue.value = [...props.modelValue]
}

const confirmEdit = () => {
  emit('update:modelValue', tempValue.value)
  isEditing.value = false
}

const cancelEdit = () => {
  isEditing.value = false
}
</script>

<style scoped>
.complex-array-editor {
  position: relative;
  min-height: 32px;
}

.edit-container {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1000;
  background: white;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  padding: 8px;
  border-radius: 4px;
  width: 300px;
}

.edit-actions {
  margin-top: 8px;
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}
</style>
