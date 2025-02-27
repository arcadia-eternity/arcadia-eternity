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
        <el-tooltip v-if="isNullable" content="设为空值" placement="top">
          <el-button class="null-btn" type="warning" :icon="Remove" circle size="small" @click="setToNull" />
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

        <div v-else-if="isTupleType" class="tuple-editor">
          <div class="tuple-header">
            <span class="title">{{ label }}</span>
            <el-tooltip v-if="tupleError" effect="dark" :content="tupleError" placement="top">
              <el-icon class="error-icon"><Warning /></el-icon>
            </el-tooltip>
          </div>

          <div class="tuple-items">
            <div v-for="(itemSchema, index) in tupleSchemas" :key="index" class="tuple-item">
              <el-input-number
                v-if="itemSchema instanceof z.ZodNumber"
                v-model="localTupleValue[index]"
                :placeholder="getPlaceholder(itemSchema)"
                :step="getNumberStep(itemSchema)"
                :min="getNumberMin(itemSchema)"
                :max="getNumberMax(itemSchema)"
                @change="val => handleTupleChange(index, val)"
                :class="{ 'error-field': tupleError }"
              />
              <el-input
                v-else-if="itemSchema instanceof z.ZodString"
                v-model="localTupleValue[index]"
                :placeholder="getPlaceholder(itemSchema)"
                @change="val => handleTupleChange(index, val)"
                :class="{ 'error-field': tupleError }"
              />
              <span v-else class="unsupported-type"> 不支持的类型：{{ itemSchema.constructor.name }} </span>
            </div>
          </div>

          <div v-if="tupleError" class="error-message">
            {{ tupleError }}
          </div>
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
import { CirclePlus, Close, Remove } from '@element-plus/icons-vue'
import EnhancedArrayEditor from './EnhancedArrayEditor.vue'

// 修改组件props定义
const props = defineProps<{
  modelValue: any // 使用更宽松的类型
  schema: z.ZodTypeAny // 修改为正确的Zod类型
  label?: string
}>()

const isOptional = computed(() => {
  // 递归解包函数
  const checkOptional = (schema: z.ZodTypeAny): boolean => {
    if (schema instanceof z.ZodOptional) return true
    if (schema instanceof z.ZodDefault) return true

    // 处理特殊包装类型
    if (schema instanceof z.ZodEffects) {
      return checkOptional(schema._def.schema)
    }
    if (schema instanceof z.ZodNullable) {
      return checkOptional(schema._def.innerType)
    }

    // 处理对象和数组类型（可选字段）
    if (schema instanceof z.ZodObject) {
      return Object.values(schema.shape).some(fieldSchema => fieldSchema.isOptional())
    }
    if (schema instanceof z.ZodArray) {
      return schema._def.exactLength === undefined
    }

    return false
  }

  return checkOptional(props.schema)
})

const emit = defineEmits(['update:modelValue'])

const unwrappedSchema = computed(() => {
  let schema = props.schema
  while (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodEffects
  ) {
    if (schema instanceof z.ZodEffects) {
      schema = schema._def.schema
    } else {
      schema = schema._def.innerType
    }
  }
  return schema
})

const tupleChecks = computed(() => {
  try {
    const checks = []
    let current: any = props.schema
    while (current instanceof z.ZodEffects) {
      checks.push(...current._def.checks)
      current = current._def.schema
    }
    return checks
  } catch {
    return []
  }
})

const isNullable = computed(() => {
  return props.schema instanceof z.ZodNullable
})

const isNullValue = computed(() => props.modelValue === null)
const isUndefined = computed(() => props.modelValue === undefined || props.modelValue === null)
const isObjectType = computed(() => unwrappedSchema.value instanceof z.ZodObject)
const isArrayType = computed(() => unwrappedSchema.value instanceof z.ZodArray)
const isEnumType = computed(() => {
  return unwrappedSchema.value instanceof z.ZodEnum || unwrappedSchema.value instanceof z.ZodNativeEnum
})
const isBooleanType = computed(() => unwrappedSchema.value instanceof z.ZodBoolean)
const isNumberType = computed(() => unwrappedSchema.value instanceof z.ZodNumber)
const isTupleType = computed(() => {
  return unwrappedSchema.value instanceof z.ZodTuple
})
const isNullableTuple = computed(() => {
  const checkNullable = (schema: z.ZodTypeAny): boolean => {
    if (schema instanceof z.ZodNullable) return true
    if (schema instanceof z.ZodEffects) return checkNullable(schema._def.schema)
    return false
  }
  return checkNullable(props.schema) && unwrappedSchema.value instanceof z.ZodTuple
})

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

const tupleSchemas = computed<z.ZodTypeAny[]>(() => {
  if (!(unwrappedSchema.value instanceof z.ZodTuple)) return []
  return unwrappedSchema.value.items
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

const localTupleValue = ref<any[]>([])
const tupleError = ref<string | null>(null)

// 修改placeholder计算属性
const placeholder = computed(() => `${props.label || ''}${isOptional.value ? '（可选）' : ''}`)

// 嵌套编辑器组件
const nestedEditorComponent = computed(() => {
  return resolveComponent('DynamicTableEditor')
})

const validateTuple = (value: any[]) => {
  try {
    // 使用原始 Schema 校验（包含所有 refine 规则）
    props.schema.parse(value)
    tupleError.value = null
    return true
  } catch (err) {
    if (err instanceof z.ZodError) {
      tupleError.value = err.errors.map(e => `${e.path.join('.')} ${e.message}`).join('; ')
    } else {
      tupleError.value = '无效的元组格式'
    }
    return false
  }
}

// 事件处理
const initValue = () => {
  let defaultValue: any
  if (isNullableTuple.value) {
    const tupleSchema = unwrappedSchema.value as z.ZodTuple
    const defaultValue = tupleSchema.items.map(s => {
      if (s instanceof z.ZodNumber) return 0
      if (s instanceof z.ZodString) return ''
      return undefined
    })
    handleChange(defaultValue)
  } else {
    if (isObjectType.value) defaultValue = {}
    else if (isArrayType.value) defaultValue = []
    else if (isBooleanType.value) defaultValue = false
    else if (isNumberType.value) defaultValue = 0
    else if (isTupleType.value) {
      const tupleSchema = unwrappedSchema.value as z.ZodTuple
      defaultValue = tupleSchema.items.map(s => {
        if (s instanceof z.ZodNumber) return 0
        if (s instanceof z.ZodString) return ''
        return undefined
      })
    } else defaultValue = ''
  }

  handleChange(defaultValue)
}

const clearValue = () => {
  if (isNullableTuple.value) {
    emit('update:modelValue', null)
  } else {
    emit('update:modelValue', undefined)
  }
}

const setToNull = () => {
  if (isNullable.value) {
    emit('update:modelValue', null)
  }
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

const handleTupleChange = (index: number, value: any) => {
  const newValue = [...localTupleValue.value]
  newValue[index] = value

  // 自动排序（示例：当检测到 refine 包含排序规则时）
  if (tupleChecks.value.some(c => c.kind === 'sort')) {
    newValue.sort((a, b) => a - b)
  }

  if (validateTuple(newValue)) {
    emit('update:modelValue', newValue)
  }
}

const getNumberStep = (schema: z.ZodNumber) => {
  return schema._def.checks.some((c: any) => c.kind === 'int') ? 1 : 0.1
}

const getNumberMin = (schema: z.ZodNumber) => {
  return schema.minValue ?? -Infinity
}

const getNumberMax = (schema: z.ZodNumber) => {
  return schema.maxValue ?? Infinity
}

const getPlaceholder = (schema: z.ZodTypeAny) => {
  if (schema instanceof z.ZodNumber) {
    const checks = schema._def.checks
    const min = checks.find((c: any) => c.kind === 'min')?.value
    const max = checks.find((c: any) => c.kind === 'max')?.value
    return `请输入${min ?? '-∞'}~${max ?? '+∞'}之间的数值`
  }
  if (schema instanceof z.ZodString) {
    const min = schema._def.checks.find((c: any) => c.kind === 'min')?.value
    return `至少${min ?? 0}个字符`
  }
  return '请输入'
}

watch(
  () => props.modelValue,
  newVal => {
    if (isNullableTuple.value) {
      // 当值为 null 时，不初始化本地值，保持显示占位符
      if (isNullableTuple.value && newVal === null) {
        localTupleValue.value = []
        return
      }
      if (newVal === null) {
        localTupleValue.value = []
        return
      }
    }
    if (Array.isArray(newVal)) {
      localTupleValue.value = newVal.map((val, index) => {
        const schema = tupleSchemas.value[index]
        if (schema instanceof z.ZodNumber) return Number(val) || 0
        if (schema instanceof z.ZodString) return String(val)
        return val
      })
      validateTuple(newVal)
    } else {
      localValue.value = newVal
    }
  },
  { immediate: true, deep: true },
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

/* 清除按钮优化 */
.null-btn {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  opacity: 0.6;
  transition: all 0.2s;
  z-index: 10;
}

.null-btn:hover {
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

.tuple-editor {
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 12px;
  position: relative;
}

.tuple-header {
  display: flex;
  align-items: center;
  margin-bottom: 8px;

  .title {
    font-size: 14px;
    font-weight: 500;
    color: #606266;
  }

  .error-icon {
    color: #f56c6c;
    margin-left: 8px;
    cursor: help;
  }
}

.tuple-items {
  display: grid;
  gap: 8px;
}

.tuple-item {
  position: relative;

  :deep(.el-input-number) {
    width: 100%;
  }
}

.error-field {
  :deep(.el-input__inner) {
    border-color: #f56c6c;
  }
}

.error-message {
  color: #f56c6c;
  font-size: 12px;
  margin-top: 4px;
}

.unsupported-type {
  color: #909399;
  font-style: italic;
}
</style>
