<template>
  <el-container class="h-screen">
    <!-- 侧边导航 -->
    <el-aside width="240px" class="bg-gray-100 border-r">
      <el-menu class="h-full">
        <el-sub-menu index="1">
          <template #title>
            <el-icon><Folder /></el-icon>
            <span>配置管理</span>
          </template>
          <el-menu-item
            v-for="file in fileList"
            :key="file"
            :index="`1-${file}`"
            @click="
              () => {
                selectedFile = file
                loadFileData()
              }
            "
          >
            {{ file }}
          </el-menu-item>
        </el-sub-menu>
      </el-menu>
    </el-aside>

    <!-- 主内容区 -->
    <el-main class="p-4">
      <!-- 操作工具栏 -->
      <div class="flex justify-between mb-4">
        <el-button
          type="primary"
          :icon="Upload"
          @click="saveChanges"
          :disabled="!currentData || dirtyFields.size === 0"
        >
          保存修改
        </el-button>

        <div class="flex gap-2">
          <el-button type="success" @click="addNewItem" :icon="Plus"> 新增条目 </el-button>
          <el-input v-model="searchText" placeholder="搜索..." clearable style="width: 200px" />
        </div>
      </div>

      <!-- 分页数据区 -->
      <el-table :data="paginatedData" v-loading="loading" border stripe height="calc(100vh - 180px)" size="small">
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ $index }">
            <el-button type="danger" size="small" :icon="Delete" @click="removeItem($index)" circle />
          </template>
        </el-table-column>
        <el-table-column v-for="col in columns" :key="col.prop" :prop="col.prop" :label="col.label" min-width="150">
          <template #default="{ row, $index }">
            <component v-if="col.render" :is="col.render(row)" />
            <el-input
              v-else
              :model-value="getValueByPath(row, col.prop)"
              @update:model-value="value => setValueByPath(row, col.prop, value)"
              size="small"
              @change="markDirty(col.prop, $index)"
            />
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页控制器 -->
      <div class="mt-4 flex justify-end">
        <el-pagination
          v-model:current-page="currentPage"
          :page-sizes="[10, 20, 50, 100]"
          :page-size="pageSize"
          layout="total, sizes, prev, pager, next, jumper"
          :total="totalItems"
          @size-change="handleSizeChange"
          @current-change="handlePageChange"
        />
      </div>
    </el-main>
  </el-container>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed, h, watch, nextTick } from 'vue'
import axios, { type AxiosResponse, type AxiosError } from 'axios'
import { Upload, Delete, Plus, InfoFilled } from '@element-plus/icons-vue'
import { DATA_SCHEMA_MAP, SCHEMA_MAP } from '@test-battle/schema'
import SpeciesSkillEditor from '@/components/SpeciesSkillEditor.vue'
import EnhancedArrayEditor from '@/components/EnhancedArrayEditor.vue'
import OptionalFieldEditor from '@/components/OptionalFieldEditor.vue'
import ArrayTagCell from '@/components/ArrayTagCell.vue'
import { generateMock } from '@anatine/zod-mock'
import { z } from 'zod'
import { useGameDataStore } from '@/stores/gameData'

interface ColumnConfig {
  prop: string // 数据路径，支持嵌套路径如 "baseStats.hp"
  label: string // 列标题
  render?: (row: any) => any // 自定义渲染函数（可选）
  width?: number // 列宽（可选）
}

type SpecialFieldConfig = {
  component: any
  label?: string
  editorProps?: Record<string, any>
  dataSource?: 'skills' | 'abilities' | 'emblems' // 关联的数据源
}

const SPECIAL_FIELDS: Record<string, SpecialFieldConfig> = {
  learnable_skills: {
    component: SpeciesSkillEditor,
    label: '可学习技能',
    editorProps: { type: 'skill' },
    dataSource: 'skills',
  },
  ability: {
    component: EnhancedArrayEditor,
    label: '特性',
    editorProps: { type: 'ability' },
    dataSource: 'abilities',
  },
  emblem: {
    component: EnhancedArrayEditor,
    label: '纹章',
    editorProps: { type: 'emblem' },
    dataSource: 'emblems',
  },
}

const columns = ref<ColumnConfig[]>([])

const currentPage = ref(1)
const pageSize = ref(20)
const totalItems = ref(0)
const searchText = ref('')
const cachedColumns = new Map<string, ColumnConfig>()

// 类型定义
type FileData<T> = {
  metadata: {
    metaType: keyof typeof DATA_SCHEMA_MAP
    version: string
  }
  preservedComments: string[]
  data: T[]
}

type ErrorDetail = {
  path: string
  code: string
  message: string
}

// 响应式数据
const fileList = ref<string[]>([])
const selectedFile = ref<string>('')
const currentData = ref<FileData<any> | null>(null)
const validationErrors = ref<ErrorDetail[] | null>(null)
const dirtyFields = reactive(new Set<string>())
const loading = ref(false)

// 方法实现
const loadFileList = async () => {
  try {
    const res = await axios.get<string[]>('/api/files')
    fileList.value = res.data.filter(f => f.endsWith('.yaml'))
  } catch (err) {
    ElMessage.error('文件列表加载失败')
  }
}

const loadFileData = async () => {
  if (!selectedFile.value) return
  loading.value = true
  try {
    // 先清空当前数据
    currentData.value = null
    columns.value = []
    dirtyFields.clear()
    cachedColumns.clear()

    const res = await axios.get<FileData<any>>(`/api/file/${selectedFile.value}`)
    await nextTick()

    currentData.value = {
      metadata: { ...res.data.metadata },
      preservedComments: [...res.data.preservedComments],
      data: [...res.data.data],
    }
  } catch (err) {
    const axiosError = err as AxiosError<{ details?: ErrorDetail[] }>
    validationErrors.value = axiosError.response?.data?.details || null
    ElMessage.error('文件加载失败')
  } finally {
    loading.value = false
  }
}

const saveChanges = async () => {
  if (!currentData.value) return

  try {
    const payload: FileData<any> = {
      metadata: { ...currentData.value.metadata },
      preservedComments: [...currentData.value.preservedComments],
      data: [...currentData.value.data],
    }

    await axios.post(`/api/file/${selectedFile.value}`, payload)
    dirtyFields.clear()
    ElMessage.success('保存成功')
  } catch (err) {
    const axiosError = err as AxiosError<{ details?: ErrorDetail[] }>
    validationErrors.value = axiosError.response?.data?.details || null
    ElMessage.error('保存失败')
  }
}

const markDirty = (field: string, index?: number) => {
  const fieldPath = index !== undefined ? `${field}[${index}]` : field
  dirtyFields.add(fieldPath)
}

const addNewItem = () => {
  if (!currentData.value) return

  const template = createTemplate(currentData.value.metadata.metaType)
  currentData.value.data.push(template)
  markDirty('data', currentData.value.data.length - 1)
}

const removeItem = (pageIndex: number) => {
  if (!currentData.value) return

  // 获取实际数据索引
  const start = (currentPage.value - 1) * pageSize.value
  const actualIndex = start + pageIndex

  // 执行删除
  currentData.value.data.splice(actualIndex, 1)
  markDirty('data', actualIndex)

  // 自动调整页码
  if (paginatedData.value.length === 1 && currentPage.value > 1) {
    currentPage.value--
  }
}

const createTemplate = (type: keyof typeof SCHEMA_MAP) => {
  const schema = SCHEMA_MAP[type]

  // @ts-ignore
  const template = generateMock(schema)

  const cleanOptionalFields = (obj: any, currentSchema: z.ZodTypeAny): any => {
    // 处理 ZodOptional
    const unwrappedSchema = unwrapSchema(currentSchema)

    if (unwrappedSchema instanceof z.ZodObject) {
      const shape = unwrappedSchema.shape
      Object.keys(shape).forEach(key => {
        const fieldSchema = shape[key]
        if (isZodOptional(fieldSchema)) {
          delete obj[key]
        } else if (obj[key] !== undefined) {
          obj[key] = cleanOptionalFields(obj[key], fieldSchema)
        }
      })
    }

    // 处理 ZodArray
    if (unwrappedSchema instanceof z.ZodArray) {
      obj = obj.map((item: any) => cleanOptionalFields(item, unwrappedSchema.element))
    }

    return obj
  }

  return cleanOptionalFields(template, schema)
}

const isZodOptional = (schema: any): schema is z.ZodOptional<any> => {
  return schema?._def?.typeName === 'ZodOptional'
}

const unwrapOptional = (schema: any): z.ZodTypeAny => {
  return isZodOptional(schema) ? schema.unwrap() : schema
}

const isZodObject = (schema: any): schema is z.ZodObject<any> => {
  const unwrapped = unwrapOptional(schema)
  return unwrapped?._def?.typeName === 'ZodObject'
}

const isZodArray = (schema: any): schema is z.ZodArray<any> => {
  const unwrapped = unwrapOptional(schema)
  return unwrapped?._def?.typeName === 'ZodArray'
}

// 递归展开所有包装类型
const unwrapSchema = (schema: any): z.ZodTypeAny => {
  if (isZodOptional(schema)) return unwrapSchema(schema.unwrap())
  if (schema instanceof z.ZodDefault) return unwrapSchema(schema.removeDefault())
  return schema
}

// 递归生成列配置
const generateColumns = (schema: z.ZodObject<any>, prefix = ''): ColumnConfig[] => {
  const fileSign = currentData.value?.metadata.version
  if (!fileSign) return []

  const fileVersion = currentData.value?.metadata.version || 'default'
  const columns: ColumnConfig[] = []
  const shape = schema.shape

  Object.entries(shape).forEach(([key, field]) => {
    const cacheKey = `${fileVersion}-${key}`

    // 使用缓存列配置
    if (cachedColumns.has(cacheKey)) {
      columns.push(cachedColumns.get(cacheKey)!)
      return
    }

    const currentPath = prefix ? `${prefix}.${key}` : key

    // 递归解包所有 Zod 包装类型
    const unwrapped = (() => {
      let current: any = field
      while (current instanceof z.ZodOptional || current instanceof z.ZodDefault || current instanceof z.ZodNullable) {
        current = current._def.innerType
      }
      return current
    })()

    // 公共配置项
    const baseConfig: ColumnConfig = {
      prop: currentPath,
      label: `${key.replace(/_/g, ' ').toUpperCase()}${isZodOptional(field) ? ' (可选)' : ''}`,
    }

    // 初始化列配置
    let columnConfig: ColumnConfig

    // 特殊字段优先处理
    if (key in SPECIAL_FIELDS) {
      columnConfig = handleSpecialField(key, currentPath)
    }
    // 处理嵌套对象
    else if (unwrapped instanceof z.ZodObject) {
      columnConfig = {
        ...baseConfig,
        render: row =>
          h(
            'div',
            generateColumns(unwrapped, currentPath).map(col =>
              h('div', { class: 'nested-column' }, [
                h('span', { class: 'nested-label' }, col.label),
                col.render?.(row),
              ]),
            ),
          ),
      }
    }
    // 处理数组类型
    else if (unwrapped instanceof z.ZodArray) {
      columnConfig = {
        ...baseConfig,
        render: row =>
          h(ArrayTagCell, {
            items: getValueByPath(row, currentPath) || [],
            'onUpdate:modelValue': val => {
              setValueByPath(row, currentPath, val)
              markDirty(currentPath)
            },
          }),
      }
    }
    // 基础类型处理
    else {
      columnConfig = {
        ...baseConfig,
        render: row =>
          h(OptionalFieldEditor, {
            modelValue: getValueByPath(row, currentPath),
            schema: field,
            label: key.replace(/_/g, ' '),
            'onUpdate:modelValue': val => {
              const newValue = val
              setValueByPath(row, currentPath, newValue)
              markDirty(currentPath)
            },
          }),
      }
    }

    // 缓存并添加列配置
    cachedColumns.set(cacheKey, columnConfig)
    columns.push(columnConfig)
  })

  return columns
}

const getValueByPath = (obj: any, path: string) => {
  return path.split('.').reduce((acc, part) => {
    if (acc === undefined) return undefined
    return acc[part]
  }, obj)
}

const setValueByPath = (obj: any, path: string, value: any) => {
  const parts = path.split('.')
  let current = obj

  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      current[part] = value
    } else {
      if (!current[part]) {
        // 根据下一个部分判断创建对象还是数组
        const nextPart = parts[index + 1]
        current[part] = /^\d+$/.test(nextPart) ? [] : {}
      }
      current = current[part]
    }
  })
}

const handleSpecialField = (fieldName: string, currentPath: string): ColumnConfig => {
  const config = SPECIAL_FIELDS[fieldName]
  const gameData = useGameDataStore() // 确保在 setup 作用域内

  return {
    prop: currentPath,
    label: config.label || fieldName.replace(/_/g, ' ').toUpperCase(),
    render: row => {
      // 获取关联数据
      const dataSource = config.dataSource ? gameData[config.dataSource] : []

      return h(config.component, {
        modelValue: getValueByPath(row, currentPath),
        'onUpdate:modelValue': (val: any) => {
          setValueByPath(row, currentPath, val)
          markDirty(currentPath)
        },
        ...config.editorProps,
        // 注入数据源
        ...(config.dataSource ? { options: dataSource } : {}),
      })
    },
  }
}

watch(
  () => ({
    metaType: currentData.value?.metadata.metaType,
    fileName: selectedFile.value, // 增加文件名监听
  }),
  ({ metaType, fileName }) => {
    if (metaType && fileName) {
      const schema = DATA_SCHEMA_MAP[metaType]
      // 强制重新解析schema
      const itemSchema = schema instanceof z.ZodArray ? schema.element : schema
      columns.value = isZodObject(itemSchema) ? generateColumns(itemSchema) : []
    }
  },
  { immediate: true },
)

const paginatedData = computed(() => {
  if (!currentData.value) return []

  // 先过滤数据
  const filteredData = currentData.value.data.filter(item =>
    JSON.stringify(item).toLowerCase().includes(searchText.value.toLowerCase()),
  )

  // 计算实际总条目
  const total = filteredData.length
  totalItems.value = total // 更新总条数

  // 处理页码越界问题
  const maxPage = Math.ceil(total / pageSize.value)
  if (currentPage.value > maxPage && maxPage > 0) {
    currentPage.value = maxPage
  }

  // 计算分页
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value

  return [...filteredData.slice(start, end)]
})

// 分页事件处理
const handleSizeChange = (newSize: number) => {
  pageSize.value = newSize
  currentPage.value = 1
}

const handlePageChange = (newPage: number) => {
  currentPage.value = newPage
}

// 生命周期
onMounted(() => {
  loadFileList()
})
</script>

<style scoped>
.el-container {
  height: 100vh;
}

.el-aside {
  transition: width 0.3s;
}

:deep(.el-table__body-wrapper) {
  overflow-x: auto;
}

:deep(.el-table .cell) {
  white-space: nowrap;
}

@media (max-width: 768px) {
  .el-aside {
    width: 60px !important;

    .el-sub-menu__title span {
      display: none;
    }
  }
}

.optional-editor {
  position: relative;
  min-height: 36px;

  .optional-placeholder {
    @apply cursor-pointer p-2 border-dashed border-gray-300 rounded hover:bg-gray-50;
    border-width: 1px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: #909399;
  }

  .nested-object {
    @apply border-l-4 border-blue-100 pl-2;

    .object-header {
      @apply flex justify-between items-center mb-2;

      .title {
        @apply text-sm font-medium text-gray-600;
      }
    }
  }
}

:deep(.el-input__wrapper) {
  padding-right: 40px; /* 为可选标签留出空间 */
}
</style>
