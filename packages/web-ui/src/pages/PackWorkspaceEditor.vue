<template>
  <div class="pack-editor-page mx-auto max-w-6xl p-4 md:p-6 space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-gray-800">数据包工作区编辑器</h1>
        <p class="text-sm text-gray-600">按数据包维度管理：模板创建、包清单查看、清单预览。</p>
      </div>
      <el-button :loading="loading" type="primary" @click="refreshWorkspace">刷新工作区</el-button>
    </div>

    <el-alert
      v-if="!isDesktop"
      type="warning"
      show-icon
      :closable="false"
      title="当前为 Web 模式"
      description="创建数据包仅在桌面端可用。Web 模式下仅尝试读取 /packs/workspace/index.json。"
    />

    <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <el-card class="xl:col-span-1" shadow="never">
        <template #header>
          <div class="font-semibold">新建数据包</div>
        </template>

        <el-form label-position="top" class="space-y-2">
          <el-form-item label="目录名（必填）">
            <el-input
              v-model.trim="createForm.folderName"
              placeholder="my-pack"
              maxlength="64"
              clearable
            />
          </el-form-item>

          <el-form-item label="包 ID（可选）">
            <el-input
              v-model.trim="createForm.packId"
              placeholder="user.my_pack"
              maxlength="128"
              clearable
            />
          </el-form-item>

          <el-form-item label="版本（可选）">
            <el-input
              v-model.trim="createForm.version"
              placeholder="0.1.0"
              maxlength="32"
              clearable
            />
          </el-form-item>

          <el-form-item label="模板">
            <el-select v-model="createForm.template" class="w-full">
              <el-option
                v-for="template in templates"
                :key="template.id"
                :label="template.name"
                :value="template.id"
              />
            </el-select>
          </el-form-item>

          <el-button
            class="w-full"
            type="success"
            :disabled="!isDesktop || !createForm.folderName"
            :loading="creating"
            @click="handleCreatePack"
          >
            从模板创建
          </el-button>
        </el-form>
      </el-card>

      <el-card class="xl:col-span-2" shadow="never">
        <template #header>
          <div class="font-semibold">工作区数据包</div>
        </template>

        <el-table :data="packs" stripe empty-text="工作区暂无数据包">
          <el-table-column prop="folderName" label="目录" min-width="150" />
          <el-table-column prop="id" label="Pack ID" min-width="200" />
          <el-table-column prop="version" label="版本" width="110" />
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="previewManifest(row.folderName)">预览清单</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <el-card shadow="never">
      <template #header>
        <div class="flex items-center justify-between gap-2">
          <span class="font-semibold">pack.json 预览</span>
          <el-tag v-if="previewFolder" type="info">{{ previewFolder }}</el-tag>
        </div>
      </template>

      <div v-if="previewLoading" class="text-sm text-gray-500">正在加载清单...</div>
      <pre
        v-else
        class="m-0 overflow-auto rounded-md bg-gray-900 p-4 text-xs leading-5 text-gray-100"
      >{{ manifestPreview || '{}' }}</pre>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { isDesktop } from '@/utils/env'
import {
  createPackFromTemplate,
  listPackTemplates,
  listWorkspacePacks,
  resolveWorkspaceFileUrl,
  type PackTemplateSummary,
  type WorkspacePackSummary,
} from '@/services/packWorkspace'

type CreateForm = {
  folderName: string
  packId: string
  version: string
  template: string
}

const loading = ref(false)
const creating = ref(false)
const previewLoading = ref(false)
const templates = ref<PackTemplateSummary[]>([])
const packs = ref<WorkspacePackSummary[]>([])
const previewFolder = ref('')
const manifestPreview = ref('')

const createForm = reactive<CreateForm>({
  folderName: '',
  packId: '',
  version: '0.1.0',
  template: 'starter',
})

async function refreshWorkspace() {
  loading.value = true
  try {
    const [templateList, packList] = await Promise.all([listPackTemplates(), listWorkspacePacks()])
    templates.value = templateList
    packs.value = packList
    if (!templates.value.some(item => item.id === createForm.template) && templates.value.length > 0) {
      createForm.template = templates.value[0].id
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ElMessage.error(`加载工作区失败: ${message}`)
  } finally {
    loading.value = false
  }
}

async function handleCreatePack() {
  if (!createForm.folderName) {
    ElMessage.warning('请先填写目录名')
    return
  }

  creating.value = true
  try {
    const result = await createPackFromTemplate({
      folderName: createForm.folderName,
      packId: createForm.packId || undefined,
      version: createForm.version || undefined,
      template: createForm.template || undefined,
    })
    ElMessage.success(`已创建数据包: ${result.folderName}`)
    createForm.folderName = ''
    createForm.packId = ''
    await refreshWorkspace()
    await previewManifest(result.folderName)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ElMessage.error(`创建失败: ${message}`)
  } finally {
    creating.value = false
  }
}

async function previewManifest(folderName: string) {
  previewLoading.value = true
  previewFolder.value = folderName
  try {
    const url = await resolveWorkspaceFileUrl(`packs/${encodeURIComponent(folderName)}/pack.json`)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const json = await response.json()
    manifestPreview.value = JSON.stringify(json, null, 2)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    manifestPreview.value = ''
    ElMessage.error(`清单加载失败: ${message}`)
  } finally {
    previewLoading.value = false
  }
}

onMounted(async () => {
  await refreshWorkspace()
  if (packs.value.length > 0) {
    await previewManifest(packs.value[0].folderName)
  }
})
</script>
