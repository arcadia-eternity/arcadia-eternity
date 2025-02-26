<!-- OptionalFieldEditor.vue -->
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
      <div v-if="isObjectType" class="nested-object">
        <div class="object-header">
          <span class="title">{{ label }}</span>
          <el-button type="danger" size="small" @click="clearValue" :icon="Delete" circle />
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
      <EnhancedArrayEditor
        v-else-if="isArrayType"
        :modelValue="modelValue"
        :schema="unwrappedSchema"
        @update:modelValue="handleChange"
      />

      <!-- 枚举类型 -->
      <el-select
        v-else-if="isEnumType"
        v-model="localValue"
        :placeholder="placeholder"
        clearable
        @change="handleChange"
      >
        <el-option v-for="option in enumOptions" :key="option.value" :label="option.label" :value="option.value" />
      </el-select>

      <!-- 布尔类型 -->
      <el-switch
        v-else-if="isBooleanType"
        v-model="localValue"
        :active-text="booleanOptions.trueText"
        :inactive-text="booleanOptions.falseText"
        @change="handleChange"
      />

      <!-- 数字类型 -->
      <el-input-number
        v-else-if="isNumberType"
        v-model="localValue"
        :min="numberOptions.min"
        :max="numberOptions.max"
        :step="numberOptions.step"
        @change="handleChange"
      />

      <!-- 默认文本输入 -->
      <el-input v-else v-model="localValue" :placeholder="placeholder" :type="inputType" @change="handleChange" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, h, ref, resolveComponent, watch } from 'vue'
import { z } from 'zod'
import { Delete, CirclePlus } from '@element-plus/icons-vue'

// 修改组件props定义
const props = defineProps<{
  modelValue: unknown // 使用更宽松的类型
  schema: z.ZodTypeAny // 修改为正确的Zod类型
  label?: string
}>()

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
const isEnumType = computed(() => unwrappedSchema.value instanceof z.ZodEnum)
const isBooleanType = computed(() => unwrappedSchema.value instanceof z.ZodBoolean)
const isNumberType = computed(() => unwrappedSchema.value instanceof z.ZodNumber)

// 修改枚举类型处理
const enumOptions = computed(() => {
  if (!isEnumType.value) return []
  const options = (unwrappedSchema.value as z.ZodEnum<[string, ...string[]]>)._def.values
  return options.map((value: string) => ({
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
// 修改placeholder计算属性
const placeholder = computed(() => `${props.label || ''}${isUndefined.value ? '（可选）' : ''}`)

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
  handleChange(undefined)
}

const handleChange = (value: unknown) => {
  // 添加类型过滤
  if (isNumberType.value && typeof value !== 'number') return
  if (isBooleanType.value && typeof value !== 'boolean') return
  emit('update:modelValue', value)
}

const handleNestedChange = (value: any) => {
  emit('update:modelValue', value)
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
.optional-placeholder {
  cursor: pointer;
  padding: 0.5rem;
  border: 1px dashed #d1d5db;
  border-radius: 0.375rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #6b7280;
  transition: all 0.2s;
}

.object-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.title {
  font-size: 0.875rem;
  font-weight: 500;
  color: #4b5563;
}

:deep(.el-input-number) {
  width: 100%;
}

:deep(.el-select) {
  width: 100%;
}
</style>
