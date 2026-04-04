<template>
  <div class="drawer-entry-shell">
    <el-empty description="图片预览已在右侧抽屉打开" :image-size="82">
      <el-button type="primary" @click="openDrawer">打开预览</el-button>
    </el-empty>
  </div>

  <el-drawer
    v-model="editorPanelVisible"
    class="pack-editor-drawer"
    direction="rtl"
    :with-header="false"
    :append-to-body="true"
    size="min(960px, 96vw)"
    modal-class="pack-editor-blur-overlay"
    @opened="handleDrawerOpened"
  >
    <div class="drawer-content">
      <div class="drawer-toolbar">
        <div class="drawer-title">{{ titleText }}</div>
        <div class="drawer-actions">
          <el-button @click="editorPanelVisible = false">关闭</el-button>
          <el-button :loading="loading" @click="loadPreviewUrl">刷新预览</el-button>
        </div>
      </div>

      <div class="preview-body">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="图片预览"
          :description="`当前文件: ${packFolder}/${relativePath}`"
        />

        <div class="preview-shell">
          <el-image
            v-if="previewUrl"
            :src="previewUrl"
            fit="contain"
            class="preview-image"
            :preview-src-list="[previewUrl]"
            preview-teleported
          >
            <template #error>
              <div class="preview-error">
                图片加载失败，请检查资源路径或本地服务状态
              </div>
            </template>
          </el-image>
        </div>
      </div>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { resolveWorkspaceFileUrl } from '@/services/packWorkspace'

const props = defineProps<{
  packFolder: string
  relativePath: string
  title?: string
}>()

const loading = ref(false)
const previewUrl = ref('')
const editorPanelVisible = ref(false)
const pendingLoad = ref(true)

const titleText = computed(() => {
  if (props.title && props.title.trim().length > 0) return props.title
  return `${props.packFolder}/${props.relativePath}`
})

async function loadPreviewUrl(): Promise<void> {
  loading.value = true
  try {
    previewUrl.value = await resolveWorkspaceFileUrl(`packs/${props.packFolder}/${props.relativePath}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ElMessage.error(`加载图片失败: ${message}`)
  } finally {
    loading.value = false
  }
}

function openDrawer(): void {
  editorPanelVisible.value = true
}

async function handleDrawerOpened(): Promise<void> {
  if (!pendingLoad.value) return
  await loadPreviewUrl()
  pendingLoad.value = false
}

watch(
  () => [props.packFolder, props.relativePath],
  async () => {
    pendingLoad.value = true
    if (!editorPanelVisible.value) return
    await handleDrawerOpened()
  },
)
</script>

<style scoped>
.drawer-entry-shell {
  height: 100%;
  border: 1px solid #d8e0ef;
  border-radius: 10px;
  background: #f8fbff;
  display: grid;
  place-items: center;
}

.drawer-content {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
}

.drawer-toolbar {
  min-height: 54px;
  border-bottom: 1px solid #d7dfef;
  background: #ffffff;
  color: #1f2a3d;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.drawer-title {
  min-width: 0;
  font-weight: 600;
  word-break: break-all;
}

.drawer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.preview-body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
}

.preview-shell {
  border-radius: 8px;
  border: 1px solid #d5deee;
  background: #f3f6fb;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  flex: 1;
}

.preview-image {
  width: 100%;
  height: 100%;
  min-height: 56vh;
}

.preview-error {
  min-height: 56vh;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  font-size: 13px;
  padding: 12px;
}

:global(.pack-editor-blur-overlay) {
  background: rgba(17, 24, 39, 0.28) !important;
  backdrop-filter: blur(8px);
}

:global(.pack-editor-drawer .el-drawer__body) {
  padding: 0;
}
</style>
