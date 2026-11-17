<script setup lang="ts">
import '@/features/management/managementStyles'
import { ElButton, ElInput, ElDialog, ElForm, ElFormItem, ElSkeleton, ElEmpty, ElAlert } from 'element-plus'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { authorCall, type SourceProject } from '@/features/authoring/types'
const router = useRouter()
const projects = ref<SourceProject[]>([])
const query = ref('')
const name = ref('')
const creating = ref(false)
const busy = ref(false)
const initialized = ref(false)
const error = ref('')
const canAuthor = !!window.arcadiaDesktop?.author
const visible = computed(() =>
  projects.value.filter(project => !project.readOnly && project.name.toLowerCase().includes(query.value.toLowerCase())),
)
async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '项目操作失败'
  } finally {
    busy.value = false
  }
}
async function refresh() {
  projects.value = await authorCall<SourceProject[]>({ action: 'list' })
}
async function open(project: SourceProject) {
  await router.push({ name: 'AuthorWorkspace', params: { projectId: project.id } })
}
async function create() {
  await run(async () => open(await authorCall<SourceProject>({ action: 'create', name: name.value.trim() })))
}
async function choose() {
  await run(async () => {
    const project = await authorCall<SourceProject | null>({ action: 'open' })
    if (project) await open(project)
  })
}
async function forget(project: SourceProject) {
  await run(async () => {
    await authorCall({ action: 'forget', id: project.id })
    await refresh()
  })
}
onMounted(() => {
  if (canAuthor)
    void run(refresh).finally(() => {
      initialized.value = true
    })
  else initialized.value = true
})
</script>
<template>
  <section class="projects" aria-label="UGC 项目" :aria-busy="busy">
    <header>
      <ElInput v-model="query" clearable aria-label="搜索项目" placeholder="搜索项目" class="search" />
      <div v-if="canAuthor" class="actions">
        <ElButton :disabled="busy" @click="choose">打开项目文件夹</ElButton>
        <ElButton type="primary" :disabled="busy" @click="creating = true">新建内容包</ElButton>
      </div>
    </header>
    <ElAlert v-if="!canAuthor" title="编辑项目需要桌面客户端。" type="info" :closable="false" />
    <ElAlert v-if="error" :title="error" type="error" :closable="false" role="alert" />
    <ElSkeleton v-if="!initialized" :rows="4" animated aria-label="正在加载项目" />
    <template v-else>
      <ul v-if="visible.length">
        <li v-for="project in visible" :key="project.id">
          <ElButton class="project" text :disabled="busy" @click="open(project)">{{ project.name }}</ElButton>
          <div class="actions">
            <ElButton
              :disabled="busy"
              @click="
                run(async () => {
                  await authorCall({ action: 'export', id: project.id })
                })
              "
              >导出源码</ElButton
            >
            <ElButton text :disabled="busy" title="保留源文件" @click="forget(project)">从列表移除</ElButton>
          </div>
        </li>
      </ul>
      <ElEmpty v-else-if="canAuthor && !error" :description="query ? '无匹配项目' : '暂无项目'" :image-size="72" />
    </template>
    <ElDialog
      v-model="creating"
      title="新建内容包"
      width="min(440px, calc(100vw - 32px))"
      :close-on-click-modal="false"
    >
      <ElForm label-position="top" @submit.prevent="create">
        <ElFormItem label="内容包名称">
          <ElInput v-model="name" aria-label="内容包名称" maxlength="80" />
        </ElFormItem>
        <div class="dialog-actions">
          <ElButton :disabled="busy" @click="creating = false">取消</ElButton>
          <ElButton type="primary" native-type="submit" :loading="busy" :disabled="!name.trim()">创建并打开</ElButton>
        </div>
      </ElForm>
    </ElDialog>
  </section>
</template>
<style scoped>
.projects {
  padding: 8px 20px 24px;
}
header,
li,
.actions,
.dialog-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
header {
  justify-content: space-between;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.search {
  width: 280px;
  max-width: 100%;
}
.actions {
  flex-wrap: wrap;
}
.actions :deep(.el-button) {
  margin-left: 0;
}
ul {
  padding: 0;
  list-style: none;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  background: var(--el-bg-color);
  overflow: hidden;
}
li {
  padding: 12px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--el-border-color-light);
}
li:last-child {
  border-bottom: 0;
}
.project {
  flex: 1;
  min-width: 140px;
  justify-content: flex-start;
  font-weight: 600;
}
.dialog-actions {
  justify-content: flex-end;
}
@media (max-width: 600px) {
  .search {
    width: 100%;
  }
  li {
    align-items: flex-start;
  }
  .project {
    flex-basis: 100%;
  }
}
</style>
