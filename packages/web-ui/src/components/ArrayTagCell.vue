<template>
  <div class="array-tag-container">
    <!-- 编辑模式 -->
    <template v-if="editMode">
      <!-- 现有项编辑区 -->
      <div v-for="(item, index) in localItems" :key="index" class="tag-item">
        <el-input
          v-if="editingIndex === index"
          ref="editInputs"
          v-model="editingValue"
          size="small"
          class="edit-input"
          @keyup.enter="confirmEdit(index)"
          @blur="confirmEdit(index)"
        />
        <el-tag v-else :type="tagType" size="small" class="editable-tag" @dblclick="startEdit(index, item)">
          <span class="truncate">{{ formatItem(item) }}</span>
          <el-icon class="tag-close" @click.stop="removeItem(index)">
            <Close />
          </el-icon>
        </el-tag>
      </div>

      <!-- 新增项输入区 -->
      <div class="new-item-input">
        <el-input
          v-model="newItemValue"
          size="small"
          placeholder="输入新项"
          @keyup.enter="addNewItem"
          @blur="addNewItem"
        >
          <template #append>
            <el-button class="append-btn" @click="addNewItem">
              <el-icon><Plus /></el-icon>
            </el-button>
          </template>
        </el-input>
      </div>

      <!-- 操作按钮 -->
      <div class="action-buttons">
        <el-button type="primary" size="small" @click="saveChanges">保存</el-button>
        <el-button size="small" @click="cancelEdit">取消</el-button>
      </div>
    </template>

    <!-- 展示模式 -->
    <template v-else>
      <el-tag
        v-for="(item, index) in displayItems"
        :key="index"
        :type="tagType"
        size="small"
        class="static-tag"
        @click="toggleEditMode"
      >
        <span class="truncate">{{ formatItem(item) }}</span>
        <el-icon v-if="closable" class="tag-close" @click.stop="removeItem(index)">
          <Close />
        </el-icon>
      </el-tag>
      <el-tag v-if="hiddenCount > 0" type="info" size="small" class="more-tag"> +{{ hiddenCount }} </el-tag>
      <el-button v-if="editable" size="small" class="edit-trigger" @click="toggleEditMode" link>
        <el-icon><Edit /></el-icon>
      </el-button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Close, Edit, Plus } from '@element-plus/icons-vue'
import { computed, ref, watch, nextTick } from 'vue'

const props = withDefaults(
  defineProps<{
    items?: Array<string | number | boolean | object>
    maxDisplay?: number
    tagType?: '' | 'success' | 'info' | 'warning' | 'danger'
    closable?: boolean
    editable?: boolean
    itemType?: 'string' | 'number' | 'json'
    maxItems?: number
  }>(),
  {
    maxDisplay: 5,
    tagType: '',
    closable: false,
    editable: true,
    itemType: 'string',
    maxItems: 100,
  },
)

const emit = defineEmits(['update:items', 'change', 'item-added', 'item-removed'])

// 响应式状态
const editMode = ref(false)
const localItems = ref([...(props.items || [])])
const editingIndex = ref(-1)
const editingValue = ref('')
const newItemValue = ref('')

// 计算属性
const displayItems = computed(() => {
  return props.editable && !editMode.value
    ? props.items?.slice(0, props.maxDisplay) || []
    : localItems.value.slice(0, props.maxDisplay)
})

const hiddenCount = computed(() => {
  return Math.max((props.items?.length || 0) - props.maxDisplay, 0)
})

// 观察外部变化
watch(
  () => props.items,
  newVal => {
    if (!editMode.value) {
      localItems.value = [...(newVal || [])]
    }
  },
)

// 进入编辑模式
const toggleEditMode = () => {
  if (props.editable) {
    editMode.value = !editMode.value
    localItems.value = [...(props.items || [])]
    if (editMode.value) {
      nextTick(() => {
        const inputs = document.querySelectorAll('.edit-input')
        if (inputs.length > 0) {
          ;(inputs[0] as HTMLInputElement).focus()
        }
      })
    }
  }
}

// 启动编辑项
const startEdit = async (index: number, value: any) => {
  if (!props.editable) return

  editingIndex.value = index
  editingValue.value = formatValueForEditing(value)

  await nextTick()
  const inputRef = document.querySelectorAll('.edit-input')[index]
  if (inputRef) {
    ;(inputRef as HTMLInputElement).focus()
  }
}

// 确认编辑
const confirmEdit = (index: number) => {
  if (validateInput(editingValue.value)) {
    const newValue = parseEditedValue(editingValue.value)
    localItems.value.splice(index, 1, newValue)
  }
  editingIndex.value = -1
}

// 添加新项
const addNewItem = () => {
  if (validateInput(newItemValue.value) && localItems.value.length < props.maxItems) {
    const newValue = parseEditedValue(newItemValue.value)
    localItems.value.push(newValue)
    emit('item-added', newValue)
    newItemValue.value = ''
    nextTick(() => {
      const inputs = document.querySelectorAll('.el-input__inner')
      const lastInput = inputs[inputs.length - 1] as HTMLInputElement
      lastInput?.focus()
    })
  }
}

// 删除项
const removeItem = (index: number) => {
  const removed = localItems.value.splice(index, 1)
  saveChanges()
}

// 保存修改
const saveChanges = () => {
  emit('update:items', [...localItems.value])
  toggleEditMode()
}

// 取消编辑
const cancelEdit = () => {
  localItems.value = [...(props.items || [])]
  toggleEditMode()
}

// 值格式化方法
const formatItem = (item: unknown): string => {
  if (typeof item === 'object') {
    try {
      const json = JSON.stringify(item)
      return json.length > 20 ? json.slice(0, 17) + '...' : json
    } catch {
      return '[复杂对象]'
    }
  }
  return String(item)
}

// 值验证方法
const validateInput = (value: string): boolean => {
  const trimmed = value.trim()
  if (!trimmed) return false

  try {
    switch (props.itemType) {
      case 'number':
        return !isNaN(Number(trimmed))
      case 'json':
        JSON.parse(trimmed)
        return true
      default:
        return true
    }
  } catch {
    return false
  }
}

// 值解析方法
const parseEditedValue = (value: string) => {
  const trimmed = value.trim()
  try {
    switch (props.itemType) {
      case 'number':
        return Number(trimmed)
      case 'json':
        return JSON.parse(trimmed)
      default:
        return trimmed
    }
  } catch {
    return trimmed
  }
}

// 编辑值格式化
const formatValueForEditing = (value: any): string => {
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}
</script>

<style scoped>
.array-tag-container {
  position: relative;
  min-height: 32px;
  padding: 2px;
  border: 1px solid transparent;
  transition: all 0.2s;
}

.array-tag-container:hover {
  border-color: var(--el-border-color);
}

.edit-mode {
  border-color: var(--el-color-primary);
}

.tag-item {
  display: inline-flex;
  margin: 2px;
  vertical-align: top;
}

.editable-tag {
  cursor: pointer;
  transition: all 0.2s;
  max-width: 200px;
}

.editable-tag:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.static-tag {
  cursor: default;
}

.edit-input {
  width: 120px;
  vertical-align: top;
}

.new-item-input {
  display: inline-block;
  margin-left: 8px;
  width: 160px;
  vertical-align: top;
}

.append-btn {
  padding: 5px;
}

.action-buttons {
  margin-top: 8px;
  text-align: right;
}

.tag-close {
  margin-left: 4px;
  padding: 1px;
  border-radius: 50%;
  transition: all 0.2s;
}

.tag-close:hover {
  background-color: rgba(0, 0, 0, 0.1);
}

.more-tag {
  cursor: help;
}

.edit-trigger {
  margin-left: 4px;
  padding: 0 4px;
}

.truncate {
  display: inline-block;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

/* 响应式调整 */
@media (max-width: 768px) {
  .edit-input {
    width: 100px;
  }

  .new-item-input {
    width: 120px;
  }

  .truncate {
    max-width: 80px;
  }
}
</style>
