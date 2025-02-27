<template>
  <div class="optional-editor">
    <!-- 未定义状态 -->
    <div v-if="isUndefined" class="optional-placeholder" @click="initValue">
      <el-icon><CirclePlus /></el-icon>
      <span>点击添加{{ label }}</span>
    </div>

    <!-- 已定义状态 -->
    <template v-else>
      <!-- 对象类型 -->
      <div class="editor-container">
        <el-tooltip v-if="isOptional" content="清空字段" placement="top">
          <el-button class="clear-btn" type="danger" :icon="Close" circle size="small" @click="clearValue" />
        </el-tooltip>
        <div v-if="isObjectType" class="nested-object">
          <div class="object-header">
            <span class="title">{{ label }}</span>
          </div>
          <div class="object-content">
            <component
              :is="nestedEditorComponent"
              :schema="unwrappedSchema"
              :modelValue="modelValue"
              @update:modelValue="handleNestedChange"
            />
          </div>
        </div>

        <!-- 数组类型 -->
        <div v-else-if="isArrayType" class="array-editor">
          <div class="array-header">
            <span class="title">{{ label }}</span>
          </div>
          <EnhancedArrayEditor :modelValue="modelValue" :schema="unwrappedSchema" @update:modelValue="handleChange" />
        </div>

        <!-- 枚举类型 -->
        <div v-else-if="isEnumType" class="enum-editor">
          <el-select v-model="localEnumValue" :placeholder="placeholder" clearable @change="handleEnumChange">
            <el-option v-for="option in enumOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </div>

        <!-- 布尔类型 -->
        <div v-else-if="isBooleanType" class="boolean-editor">
          <el-switch
            v-model="localBooleanValue"
            :active-text="booleanOptions.trueText"
            :inactive-text="booleanOptions.falseText"
          />
        </div>

        <!-- 数字类型 -->
        <div v-else-if="isNumberType" class="number-editor">
          <el-input-number
            v-model="localNumberValue"
            :min="numberOptions.min"
            :max="numberOptions.max"
            :step="numberOptions.step"
            @change="val => emit('update:modelValue', val)"
          />
        </div>

        <!-- 默认文本输入 -->
        <div v-else class="text-editor">
          <el-input
            v-model="localStringValue"
            :placeholder="placeholder"
            :type="inputType"
            clearable
            @change="handleStringChange"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, h, ref, resolveComponent, watch } from 'vue'
import { z } from 'zod'
import { CirclePlus, Close } from '@element-plus/icons-vue'
import EnhancedArrayEditor from './EnhancedArrayEditor.vue'

// 修改组件props定义
const props = defineProps<{
  modelValue: any // 使用更宽松的类型
  schema: z.ZodTypeAny // 修改为正确的Zod类型
  label?: string
}>()

const isOptional = computed(() => {
  return props.schema instanceof z.ZodOptional || props.schema instanceof z.ZodDefault
})

const emit = defineEmits(['update:modelValue'])

// 类型判断辅助函数
const unwrappedSchema = computed(() => {
  let schema = props.schema
  while (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    schema = schema._def.innerType
  }
  return schema
})

const isUndefined = computed(() => props.modelValue === undefined)
const isObjectType = computed(() => unwrappedSchema.value instanceof z.ZodObject)
const isArrayType = computed(() => unwrappedSchema.value instanceof z.ZodArray)
const isEnumType = computed(() => {
  return unwrappedSchema.value instanceof z.ZodEnum || unwrappedSchema.value instanceof z.ZodNativeEnum
})
const isBooleanType = computed(() => unwrappedSchema.value instanceof z.ZodBoolean)
const isNumberType = computed(() => unwrappedSchema.value instanceof z.ZodNumber)

// 修改枚举类型处理

const enumOptions = computed(() => {
  if (!isEnumType.value) return []

  let options: string[] = []

  // 处理 ZodEnum（z.enum(["A", "B"])）
  if (unwrappedSchema.value instanceof z.ZodEnum) {
    options = (unwrappedSchema.value as z.ZodEnum<[string, ...string[]]>)._def.values
  }
  // 处理 ZodNativeEnum（z.nativeEnum(MyEnum)）
  else if (unwrappedSchema.value instanceof z.ZodNativeEnum) {
    const enumObj = (unwrappedSchema.value as z.ZodNativeEnum<Record<string, string>>)._def.values
    // 过滤出字符串值（假设是字符串枚举）
    options = Object.values(enumObj).filter((v): v is string => typeof v === 'string')
  }

  return options.map(value => ({
    value,
    label: value.replace(/_/g, ' ').toUpperCase(),
  }))
})

// 数字类型配置
const numberOptions = computed(() => {
  if (!isNumberType.value) return {}
  const schema = unwrappedSchema.value as z.ZodNumber
  return {
    min: schema.minValue ?? -Infinity,
    max: schema.maxValue ?? Infinity,
    step: 1,
  }
})

// 布尔类型显示配置
const booleanOptions = computed(() => ({
  trueText: '是',
  falseText: '否',
}))

// 输入类型推断
const inputType = computed(() => {
  if (unwrappedSchema.value instanceof z.ZodNumber) return 'number'
  if (unwrappedSchema.value instanceof z.ZodString) return 'text'
  return 'text'
})

const localValue = ref<number | undefined>(props.modelValue as number | undefined)

const localEnumValue = computed({
  get: () => (props.modelValue !== undefined ? props.modelValue : undefined),
  set: val => emit('update:modelValue', val),
})

const localBooleanValue = computed({
  get: () => props.modelValue as boolean,
  set: val => emit('update:modelValue', val),
})

const localNumberValue = computed({
  get: () => props.modelValue as number | undefined,
  set: val => emit('update:modelValue', val),
})

const localStringValue = computed({
  get: () => (props.modelValue !== undefined ? String(props.modelValue) : ''),
  set: val => emit('update:modelValue', val.trim() || undefined),
})

// 修改placeholder计算属性
const placeholder = computed(() => `${props.label || ''}${isOptional.value ? '（可选）' : ''}`)

// 嵌套编辑器组件
const nestedEditorComponent = computed(() => {
  return resolveComponent('DynamicTableEditor')
})

// 事件处理
const initValue = () => {
  let defaultValue: any
  if (isObjectType.value) defaultValue = {}
  else if (isArrayType.value) defaultValue = []
  else if (isBooleanType.value) defaultValue = false
  else if (isNumberType.value) defaultValue = 0
  else defaultValue = ''

  handleChange(defaultValue)
}

const clearValue = () => {
  emit('update:modelValue', undefined)
}

const handleChange = (value: unknown) => {
  emit('update:modelValue', value)
}

const handleNumberChange = (val: number | undefined) => {
  emit('update:modelValue', val !== undefined ? val : undefined)
}

const handleNestedChange = (value: any) => {
  emit('update:modelValue', value)
}

const handleEnumChange = (val: string | null) => {
  emit('update:modelValue', val !== null ? val : undefined)
}

const handleStringChange = (val: string) => {
  emit('update:modelValue', val !== '' ? val : undefined)
}

watch(
  () => props.modelValue,
  newVal => {
    localValue.value = newVal
  },
  { immediate: true },
)
</script>

<style scoped>
/* 基础容器样式 */
.optional-editor {
  position: relative;
  margin: 8px 0;
}

/* 占位符状态 */
.optional-placeholder {
  cursor: pointer;
  padding: 8px 12px;
  border: 1px dashed var(--el-border-color);
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--el-text-color-secondary);
  transition: all 0.2s;
  background-color: var(--el-fill-color-lighter);
}

.optional-placeholder:hover {
  border-color: var(--el-color-primary);
  background-color: var(--el-fill-color);
}

/* 清除按钮优化 */
.clear-btn {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  opacity: 0.6;
  transition: all 0.2s;
  z-index: 10;
}

.clear-btn:hover {
  opacity: 1;
  transform: translateY(-50%) scale(1.1);
}

/* 对象类型样式 */
.nested-object {
  .object-header {
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px dashed var(--el-border-color);

    .title {
      font-size: 13px;
      font-weight: 600;
      color: var(--el-text-color-regular);
    }
  }
}

/* 数组编辑器调整 */
.array-editor {
  margin-top: 8px;
}

/* 布尔开关样式 */
.boolean-editor {
  display: flex;
  align-items: center;
  height: 32px;

  :deep(.el-switch__label) {
    color: var(--el-text-color-regular);
    font-size: 13px;
  }
}

/* 枚举选择器优化 */
.enum-editor {
  :deep(.el-select) {
    min-width: 180px;
  }
}

/* 响应式调整 */
@media (max-width: 768px) {
  .editor-container {
    padding: 8px;
  }

  .clear-btn {
    right: 4px;
    padding: 4px;
  }
}
</style>
