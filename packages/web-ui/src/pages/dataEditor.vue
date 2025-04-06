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
    <component
      v-if="selectedFile != ''"
      :is="editorComponent"
      :key="selectedFile"
      :currentData="currentData"
      :selectedFile="selectedFile"
      @save="handleSave"
    />
  </el-container>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed, h, watch, nextTick } from 'vue'
import axios, { type AxiosResponse, type AxiosError } from 'axios'
import EffectGraphEditor from './EffectGraphEditor.vue'
import GenericTableEditor from './GenericTableEditor.vue'
import { DATA_SCHEMA_MAP } from '@test-battle/schema'
import type { FileData, ErrorDetail } from './fileData'

const editorComponent = computed(() => {
  return currentData.value?.metadata.metaType === 'effect' ? EffectGraphEditor : GenericTableEditor
})

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
    dirtyFields.clear()

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

const handleSave = async (payload: FileData<any>) => {
  try {
    loading.value = true
    const res = await axios.post(`/api/file/${selectedFile.value}`, payload)

    // 更新本地数据
    currentData.value = res.data
    dirtyFields.clear()
    ElMessage.success('保存成功')
  } catch (err) {
    handleSaveError(err)
  } finally {
    loading.value = false
  }
}

const handleSaveError = (err: unknown) => {
  if (axios.isAxiosError(err)) {
    if (err.response?.status === 409) {
      showConflictResolutionDialog(err.response.data)
    } else {
      ElMessage.error(`保存失败: ${err.message}`)
    }
  } else if (err instanceof Error) {
    ElMessage.error(`系统错误: ${err.message}`)
  } else {
    ElMessage.error('发生未知错误')
  }
}

const showConflictResolutionDialog = (serverData: FileData<any>) => {
  ElMessageBox.confirm('服务器数据已变更，请选择处理方式', '数据冲突', {
    distinguishCancelAndClose: true,
    confirmButtonText: '覆盖服务器',
    cancelButtonText: '保留本地',
    showClose: false,
  })
    .then(() => {
      // 强制覆盖
      return axios.post(`/api/file/${selectedFile.value}`, currentData.value, {
        headers: { 'X-Force-Overwrite': 'true' },
      })
    })
    .catch(action => {
      if (action === 'cancel') {
        // 放弃本地修改
        loadFileData()
      }
    })
}

watch(
  () => ({
    metaType: currentData.value?.metadata?.metaType,
    fileName: selectedFile.value, // 增加文件名监听
  }),
  ({ metaType, fileName }) => {
    if (metaType && fileName) {
      const schema = DATA_SCHEMA_MAP[metaType]
    }
  },
  { immediate: true },
)

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

:deep(.el-input__wrapper) {
  padding-right: 40px; /* 为可选标签留出空间 */
}
</style>
