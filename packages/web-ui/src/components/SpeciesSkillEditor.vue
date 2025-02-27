<template>
  <div class="popover-skill-editor">
    <div class="skills-container">
      <!-- 技能条目 -->
      <div v-for="(item, index) in modelValue" :key="index" class="skill-item">
        <el-popover
          :visible="activeIndex === index"
          placement="bottom"
          :width="360"
          :persistent="false"
          trigger="click"
          @show="handlePopoverShow(index)"
          @hide="handlePopoverHide"
        >
          <template #reference>
            <div class="skill-tag" @click.stop="togglePopover(index)">
              <span class="skill-name">{{ getSkillName(item.skill_id) }}</span>
              <span class="skill-meta">
                Lv.{{ item.level }}
                <el-icon v-if="item.hidden" class="hidden-icon"><Hide /></el-icon>
              </span>
              <el-icon class="remove-btn" @click.stop="removeItem(index)">
                <Close />
              </el-icon>
            </div>
          </template>

          <!-- 编辑内容 -->
          <div v-if="shouldRenderContent(index)" class="popover-content">
            <el-select-v2
              v-model="tempItem.skill_id"
              filterable
              allow-create
              remote
              :remote-method="filterSkills"
              :loading="searchLoading"
              :options="virtualOptions"
              :popper-height="300"
              placeholder="输入技能ID"
              size="small"
              style="width: 100%"
              @change="handleSkillChange"
            >
              <template #default="{ item }">
                <span>{{ item.label }}</span>
                <span style="float: right; color: #8492a6; font-size: 13px">{{ item.value }}</span>
              </template>
            </el-select-v2>

            <div class="form-controls">
              <el-input-number
                v-model="tempItem.level"
                :min="1"
                :max="100"
                controls-position="right"
                size="small"
                style="margin: 8px 0"
              />
              <el-switch v-model="tempItem.hidden" active-text="隐藏" inline-prompt />
              <div class="popover-actions">
                <el-button type="primary" size="small" @click="confirmEdit">保存</el-button>
                <el-button size="small" @click="cancelEdit">取消</el-button>
              </div>
            </div>
          </div>
        </el-popover>
      </div>

      <!-- 添加按钮 -->
      <el-popover
        :visible="showAddPopover"
        placement="bottom"
        :width="360"
        :persistent="false"
        trigger="click"
        @show="handleAddPopoverShow"
        @hide="handleAddPopoverHide"
      >
        <template #reference>
          <div class="add-trigger" @click.stop="toggleAddPopover">
            <el-icon><Plus /></el-icon>
            添加技能
          </div>
        </template>

        <!-- 添加内容 -->
        <div v-if="shouldRenderAddContent" class="popover-content">
          <el-select-v2
            v-model="newItem.skill_id"
            filterable
            allow-create
            remote
            :remote-method="filterSkills"
            :loading="searchLoading"
            :options="virtualOptions"
            :popper-height="300"
            placeholder="输入技能ID"
            size="small"
            style="width: 100%"
          >
            <template #default="{ item }">
              <span>{{ item.label }}</span>
              <span style="float: right; color: #8492a6; font-size: 13px">{{ item.value }}</span>
            </template>
          </el-select-v2>

          <div class="form-controls">
            <el-input-number
              v-model="newItem.level"
              :min="1"
              :max="100"
              controls-position="right"
              size="small"
              style="margin: 8px 0"
            />
            <el-switch v-model="newItem.hidden" active-text="隐藏" inline-prompt />
            <div class="popover-actions">
              <el-button type="primary" size="small" @click="confirmAdd">添加</el-button>
              <el-button size="small" @click="cancelAdd">取消</el-button>
            </div>
          </div>
        </div>
      </el-popover>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watchEffect } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { useGameDataStore } from '@/stores/gameData'
import type { LearnableSkill, Skill } from '@test-battle/schema'

const props = defineProps<{
  modelValue: LearnableSkill[]
}>()

const emit = defineEmits(['update:modelValue'])

const gameData = useGameDataStore()
const activeIndex = ref<number | null>(null)
const showAddPopover = ref(false)
const tempItem = ref<LearnableSkill>({ skill_id: '', level: 1, hidden: false })
const newItem = ref<LearnableSkill>({ skill_id: '', level: 1, hidden: false })

const renderIndex = ref<number | null>(null)
const shouldRenderAdd = ref(false)

// Popover 显示控制
const togglePopover = (index: number) => {
  activeIndex.value = activeIndex.value === index ? null : index
}

const handlePopoverShow = (index: number) => {
  renderIndex.value = index
  startEdit(index)
}

const handlePopoverHide = () => {
  renderIndex.value = null
  cancelEdit()
}

// 添加按钮 Popover 控制
const toggleAddPopover = () => {
  showAddPopover.value = !showAddPopover.value
}

const handleAddPopoverShow = () => {
  shouldRenderAdd.value = true
  startAdd()
}

const handleAddPopoverHide = () => {
  shouldRenderAdd.value = false
  cancelAdd()
}

// 条件渲染方法
const shouldRenderContent = (index: number) => {
  return renderIndex.value === index
}

const shouldRenderAddContent = computed(() => {
  return shouldRenderAdd.value
})

const startEdit = (index: number) => {
  activeIndex.value = index
  tempItem.value = { ...props.modelValue[index] }

  // 延迟加载数据（如果需要）
  if (filteredSkills.value.length === 0) {
    filteredSkills.value = performSearch('')
  }
}

// 虚拟滚动相关状态
const searchLoading = ref(false)
const cachedSkills = new Map<string, Skill[]>()
const filteredSkills = ref<Skill[]>([])

// 生成虚拟滚动选项
const virtualOptions = computed(() => {
  const baseSkills = filteredSkills.value.map(skill => ({
    value: skill.id,
    label: `${skill.name} (${skill.id})`,
    raw: skill,
  }))

  // 合并自定义项
  const customItems = [...props.modelValue.map(item => item.skill_id), newItem.value.skill_id, tempItem.value.skill_id]
    .filter(id => id && !gameData.skills.byId[id])
    .map(id => ({
      value: id,
      label: id,
      raw: { id, name: id },
    }))

  return [...new Map([...baseSkills, ...customItems].map(item => [item.value, item])).values()]
})

// 优化后的搜索方法
const filterSkills = useDebounceFn(async (query = '') => {
  searchLoading.value = true
  const cacheKey = query.toLowerCase()

  if (cachedSkills.has(cacheKey)) {
    filteredSkills.value = cachedSkills.get(cacheKey)!
    searchLoading.value = false
    return
  }

  const results = await performSearch(query)
  cachedSkills.set(cacheKey, results)
  filteredSkills.value = results
  searchLoading.value = false
}, 300)

// 执行搜索逻辑
const performSearch = (query: string) => {
  const q = query.trim().toLowerCase()
  const allSkills = Object.values(gameData.skills.byId)

  if (!q) return allSkills.slice(0, 50)

  return allSkills
    .filter(skill => skill.id.toLowerCase().includes(q) || skill.name.toLowerCase().includes(q))
    .slice(0, 100)
}

// 初始化加载数据
watchEffect(() => {
  filteredSkills.value = performSearch('')
})

// 处理自定义技能创建
const handleSkillChange = (value: string) => {
  if (!value) return
}

// 其他原有方法保持不变
const getSkillName = (skillId: string) => {
  return gameData.skills.byId[skillId]?.name || skillId
}

const confirmEdit = () => {
  const newValue = [...props.modelValue]
  if (activeIndex.value === null) return

  newValue[activeIndex.value] = tempItem.value
  emit('update:modelValue', newValue)
  activeIndex.value = null
}

const cancelEdit = () => {
  activeIndex.value = null
}

const startAdd = () => {
  showAddPopover.value = true
  newItem.value = { skill_id: '', level: 1, hidden: false }
}

const confirmAdd = () => {
  if (!newItem.value.skill_id) {
    ElMessage.warning('请输入技能ID')
    return
  }

  emit('update:modelValue', [...props.modelValue, newItem.value])
  showAddPopover.value = false
}

const cancelAdd = () => {
  showAddPopover.value = false
}

const removeItem = (index: number) => {
  const newValue = props.modelValue.filter((_, i) => i !== index)
  emit('update:modelValue', newValue)
}
</script>

<style scoped>
/* 原有样式保持不变 */
.popover-skill-editor {
  --tag-height: 32px;
  --tag-bg: var(--el-fill-color-light);
  --tag-hover-bg: var(--el-fill-color);
}

.skills-container {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.skill-tag {
  height: var(--tag-height);
  display: flex;
  align-items: center;
  padding: 0 12px;
  background: var(--tag-bg);
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s;
  gap: 8px;
  border: 1px solid var(--el-border-color);
}

.skill-tag:hover {
  background: var(--tag-hover-bg);
  box-shadow: var(--el-box-shadow-light);
}

.skill-name {
  font-size: 14px;
  color: var(--el-color-primary);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skill-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
}

.hidden-icon {
  color: var(--el-color-danger);
  font-size: 14px;
}

.remove-btn {
  margin-left: 8px;
  color: var(--el-text-color-placeholder);
  transition: color 0.2s;
}

.remove-btn:hover {
  color: var(--el-color-danger);
}

.add-trigger {
  height: var(--tag-height);
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--el-color-primary);
  cursor: pointer;
  border: 1px dashed var(--el-color-primary-light-5);
  border-radius: 16px;
  transition: all 0.2s;
}

.add-trigger:hover {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary);
}

.popover-content {
  padding: 12px;
}

.form-controls {
  margin-top: 12px;
}

.popover-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

/* 虚拟滚动样式调整 */
:global(.el-select-v2__menu) {
  --el-select-v2-item-height: 36px;
}

:global(.el-select-v2__item) {
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
}
</style>
