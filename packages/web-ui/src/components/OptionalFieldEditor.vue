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
                v-if="isNumberSchema(itemSchema)"
                v-model="localTupleValue[index]"
                :placeholder="getPlaceholder(itemSchema)"
                :step="getNumberStep(itemSchema)"
                :min="getNumberMin(itemSchema)"
                :max="getNumberMax(itemSchema)"
                @change="val => handleTupleChange(index, val)"
                :class="{ 'error-field': tupleError }"
              />
              <el-input
                v-else-if="isStringSchema(itemSchema)"
                v-model="localTupleValue[index]"
                :placeholder="getPlaceholder(itemSchema)"
                @change="val => handleTupleChange(index, val)"
                :class="{ 'error-field': tupleError }"
              />
              <span v-else class="unsupported-type"> 不支持的类型：{{ (itemSchema as TSchema)[Kind] }} </span>
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
import { type TSchema, type TObject, type TArray, type TUnion, type TNumber, type TInteger, type TString, type TTuple, type TProperties, type TLiteral } from '@sinclair/typebox'
import { Kind, OptionalKind } from '@sinclair/typebox'
import { KindGuard } from '@sinclair/typebox/type'
import { Value } from '@sinclair/typebox/value'
import { CirclePlus, Close, Remove } from '@element-plus/icons-vue'
import EnhancedArrayEditor from './EnhancedArrayEditor.vue'

// TypeBox 类型检测辅助函数
const isNumberSchema = (schema: TSchema): boolean => KindGuard.IsNumber(schema) || KindGuard.IsInteger(schema)
const isStringSchema = (schema: TSchema): boolean => KindGuard.IsString(schema)
const isObjectSchema = (schema: TSchema): boolean => KindGuard.IsObject(schema)
const isArraySchema = (schema: TSchema): boolean => KindGuard.IsArray(schema)
const isBooleanSchema = (schema: TSchema): boolean => KindGuard.IsBoolean(schema)
const isTupleSchema = (schema: TSchema): boolean => KindGuard.IsTuple(schema)

// 检测是否为枚举类型（Union of Literals）
const isEnumSchema = (schema: TSchema): boolean => {
  if (KindGuard.IsUnion(schema)) {
    return (schema as TUnion).anyOf.every((s: TSchema) => KindGuard.IsLiteral(s))
  }
  return false
}

// 检测是否包含 Null（Nullable = Union with Null）
const hasNullInUnion = (schema: TSchema): boolean => {
  if (KindGuard.IsUnion(schema)) {
    return (schema as TUnion).anyOf.some((s: TSchema) => KindGuard.IsNull(s))
  }
  return false
}

// 检测是否有 default 值
const hasDefault = (schema: TSchema): boolean => {
  return 'default' in schema
}

// 解包 schema：移除 Optional 标记、Nullable（Union with Null）、Default
const unwrapSchemaFn = (schema: TSchema): TSchema => {
  // 如果是 Union 且包含 Null，去掉 Null 部分
  if (KindGuard.IsUnion(schema) && hasNullInUnion(schema)) {
    const nonNullTypes = (schema as TUnion).anyOf.filter((s: TSchema) => !KindGuard.IsNull(s))
    if (nonNullTypes.length === 1) {
      return unwrapSchemaFn(nonNullTypes[0])
    }
  }
  return schema
}

// 修改组件props定义
const props = defineProps<{
  modelValue: any
  schema: TSchema
  label?: string
}>()

const isOptional = computed(() => {
  const checkOptional = (schema: TSchema): boolean => {
    if (OptionalKind in schema) return true
    if (hasDefault(schema)) return true

    // 处理 Nullable（Union with Null）
    if (KindGuard.IsUnion(schema) && hasNullInUnion(schema)) {
      const nonNullTypes = (schema as TUnion).anyOf.filter((s: TSchema) => !KindGuard.IsNull(s))
      if (nonNullTypes.length === 1) {
        return checkOptional(nonNullTypes[0])
      }
    }

    // 处理对象和数组类型
    if (isObjectSchema(schema)) {
      return Object.values((schema as TObject<TProperties>).properties).some((fieldSchema: TSchema) => OptionalKind in fieldSchema)
    }
    if (isArraySchema(schema)) {
      return true // 数组总是可以为空
    }

    return false
  }

  return checkOptional(props.schema)
})

const emit = defineEmits(['update:modelValue'])

const unwrappedSchema = computed(() => {
  return unwrapSchemaFn(props.schema)
})

const isNullable = computed(() => {
  return hasNullInUnion(props.schema)
})

const isNullValue = computed(() => props.modelValue === null)
const isUndefined = computed(() => props.modelValue === undefined || props.modelValue === null)
const isObjectType = computed(() => isObjectSchema(unwrappedSchema.value))
const isArrayType = computed(() => isArraySchema(unwrappedSchema.value))
const isEnumType = computed(() => isEnumSchema(unwrappedSchema.value))
const isBooleanType = computed(() => isBooleanSchema(unwrappedSchema.value))
const isNumberType = computed(() => isNumberSchema(unwrappedSchema.value))
const isTupleType = computed(() => isTupleSchema(unwrappedSchema.value))
const isNullableTuple = computed(() => {
  return hasNullInUnion(props.schema) && isTupleSchema(unwrappedSchema.value)
})

// 枚举选项
const enumOptions = computed(() => {
  if (!isEnumType.value) return []

  const schema = unwrappedSchema.value
  if (KindGuard.IsUnion(schema)) {
    const options = schema.anyOf
      .filter((s: TSchema) => KindGuard.IsLiteral(s))
      .map((s: TSchema) => (s as TLiteral).const)
      .filter((v): v is string => typeof v === 'string')

    return options.map((value: string) => ({
      value,
      label: value.replace(/_/g, ' ').toUpperCase(),
    }))
  }

  return []
})

// 数字类型配置
const numberOptions = computed(() => {
  if (!isNumberType.value) return {}
  const schema = unwrappedSchema.value as TNumber | TInteger
  return {
    min: schema.minimum ?? -Infinity,
    max: schema.maximum ?? Infinity,
    step: schema.multipleOf ?? 1,
  }
})

const tupleSchemas = computed<TSchema[]>(() => {
  if (!isTupleSchema(unwrappedSchema.value)) return []
  return (unwrappedSchema.value as TTuple).items || []
})

// 布尔类型显示配置
const booleanOptions = computed(() => ({
  trueText: '是',
  falseText: '否',
}))

// 输入类型推断
const inputType = computed(() => {
  if (isNumberSchema(unwrappedSchema.value)) return 'number'
  if (isStringSchema(unwrappedSchema.value)) return 'text'
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
    if (Value.Check(props.schema, value)) {
      tupleError.value = null
      return true
    }
    const errors = [...Value.Errors(props.schema, value)]
    tupleError.value = errors.map(e => `${e.path} ${e.message}`).join('; ')
    return false
  } catch (err) {
    tupleError.value = '无效的元组格式'
    return false
  }
}

// 事件处理
const initValue = () => {
  let defaultValue: any
  if (isNullableTuple.value) {
    const items = (unwrappedSchema.value as TTuple).items || []
    defaultValue = items.map((s: TSchema) => {
      if (isNumberSchema(s)) return 0
      if (isStringSchema(s)) return ''
      return undefined
    })
    handleChange(defaultValue)
  } else {
    if (isObjectType.value) defaultValue = {}
    else if (isArrayType.value) defaultValue = []
    else if (isBooleanType.value) defaultValue = false
    else if (isNumberType.value) defaultValue = 0
    else if (isTupleType.value) {
      const items = (unwrappedSchema.value as TTuple).items || []
      defaultValue = items.map((s: TSchema) => {
        if (isNumberSchema(s)) return 0
        if (isStringSchema(s)) return ''
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

  if (validateTuple(newValue)) {
    emit('update:modelValue', newValue)
  }
}

const getNumberStep = (schema: TSchema) => {
  if (KindGuard.IsInteger(schema)) return 1
  return (schema as TNumber).multipleOf ?? 0.1
}

const getNumberMin = (schema: TSchema) => {
  return (schema as TNumber | TInteger).minimum ?? -Infinity
}

const getNumberMax = (schema: TSchema) => {
  return (schema as TNumber | TInteger).maximum ?? Infinity
}

const getPlaceholder = (schema: TSchema) => {
  if (isNumberSchema(schema)) {
    const min = (schema as TNumber | TInteger).minimum
    const max = (schema as TNumber | TInteger).maximum
    return `请输入${min ?? '-∞'}~${max ?? '+∞'}之间的数值`
  }
  if (isStringSchema(schema)) {
    const min = (schema as TString).minLength
    return `至少${min ?? 0}个字符`
  }
  return '请输入'
}

watch(
  () => props.modelValue,
  newVal => {
    if (isNullableTuple.value) {
      if (newVal === null) {
        localTupleValue.value = []
        return
      }
    }
    if (Array.isArray(newVal)) {
      localTupleValue.value = newVal.map((val, index) => {
        const schema = tupleSchemas.value[index]
        if (schema && isNumberSchema(schema)) return Number(val) || 0
        if (schema && isStringSchema(schema)) return String(val)
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
