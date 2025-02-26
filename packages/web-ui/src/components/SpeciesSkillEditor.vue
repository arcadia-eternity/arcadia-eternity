<template>
  <div class="nested-editor">
    <el-button type="primary" size="small" @click="dialogVisible = true">
      编辑技能配置 ({{ modelValue.length }})
    </el-button>

    <el-dialog v-model="dialogVisible" :title="`编辑可用技能`" width="800px">
      <el-table :data="modelValue" border>
        <el-table-column prop="skill_id" label="技能">
          <template #default="{ row }">
            <el-select v-model="row.skill_id" filterable placeholder="选择技能">
              <el-option v-for="skill in availableSkills" :key="skill.id" :label="skill.name" :value="skill.id" />
            </el-select>
          </template>
        </el-table-column>

        <el-table-column prop="level" label="等级" width="120">
          <template #default="{ row }">
            <el-input-number v-model="row.level" :min="1" :max="100" controls-position="right" />
          </template>
        </el-table-column>

        <el-table-column prop="hidden" label="隐藏" width="80">
          <template #default="{ row }">
            <el-switch v-model="row.hidden" />
          </template>
        </el-table-column>

        <el-table-column width="60">
          <template #default="{ $index }">
            <el-button type="danger" icon="Delete" @click="removeItem($index)" />
          </template>
        </el-table-column>
      </el-table>

      <template #footer>
        <el-button @click="addNewItem">新增条目</el-button>
        <el-button type="primary" @click="dialogVisible = false">完成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGameDataStore } from '@/stores/gameData'
import type { LearnableSkill } from '@test-battle/schema'

const props = defineProps<{
  modelValue: LearnableSkill[]
}>()

const emit = defineEmits(['update:modelValue'])

const gameData = useGameDataStore()
const dialogVisible = ref(false)

const availableSkills = computed(() => gameData.skills)

const addNewItem = () => {
  emit('update:modelValue', [...props.modelValue, { skill_id: '', level: 1, hidden: false }])
}

const removeItem = (index: number) => {
  const newValue = [...props.modelValue]
  newValue.splice(index, 1)
  emit('update:modelValue', newValue)
}
</script>
