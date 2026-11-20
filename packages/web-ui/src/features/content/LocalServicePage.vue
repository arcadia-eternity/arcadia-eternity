<script setup lang="ts">
import { ElInput, ElButton, ElCheckbox, ElSelect, ElOption } from 'element-plus'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { ContentProjectSummary, ContentProjectAction, LocalBattleHostStatus } from '@/types/desktop'
import { useLocalServerStore } from '@/stores/localServer'
import type { ContentLibrarySnapshot } from '@/types/contentPackages'
const api = window.arcadiaDesktop
const library = ref<ContentLibrarySnapshot>()
const projects = ref<ContentProjectSummary[]>([])
const selected = ref('')
const name = ref('')
const busy = ref(false),
  error = ref(''),
  notice = ref(''),
  trusted = ref(false),
  includeLocal = ref(false),
  offline = ref(false)
const status = ref<LocalBattleHostStatus>({ status: 'idle' })
let refreshGeneration = 0
let disposed = false
async function refresh() {
  const generation = ++refreshGeneration
  const [nextLibrary, nextProjects, nextStatus] = await Promise.all([
    api?.listContentPackages?.(),
    api?.listContentProjects?.(),
    api?.getLocalBattleStatus?.(),
  ])
  if (disposed || generation !== refreshGeneration) return
  library.value = nextLibrary
  projects.value = nextProjects ?? []
  status.value = nextStatus ?? { status: 'idle' }
}
async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await action()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '本机操作失败'
  } finally {
    busy.value = false
  }
}
async function add() {
  await run(async () => {
    const id = await api!.addContentProject!()
    await refresh()
    if (id) {
      selected.value = id
      selectProject()
    }
  })
}
function selectProject() {
  name.value = projects.value.find(project => project.id === selected.value)?.name ?? ''
  trusted.value = false
}
async function startProject() {
  if (!selected.value) return
  await run(async () => {
    const result = await useLocalServerStore().execute({ action: 'start-project', projectId: selected.value })
    if (!result) return
    await refresh()
    notice.value = '服务器已启动，在服务器页查看连接地址和管理设置'
  })
}
async function operate(action: ContentProjectAction['action']) {
  if (!selected.value || (action === 'approve' && !trusted.value)) return
  await run(async () => {
    await api!.contentProjectAction!({
      id: selected.value,
      action,
      name: name.value,
      offline: offline.value,
      includeLocalArtifacts: includeLocal.value,
    })
    await refresh()
    notice.value = '操作已完成'
  })
}
let refreshTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void run(refresh)
  refreshTimer = setInterval(() => {
    if (!busy.value && status.value.status === 'running') void refresh().catch(() => undefined)
  }, 5000)
})
onBeforeUnmount(() => {
  disposed = true
  clearInterval(refreshTimer)
})
</script>
<template>
  <main class="local-service">
    <h1>高级本机工具</h1>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <RouterLink to="/servers">服务器列表</RouterLink>
    <details>
      <summary>高级服务器项目管理</summary>
      <ElButton :disabled="busy" @click="add">登记项目目录</ElButton
      ><label
        >已有项目<ElSelect filterable aria-label="已有项目" v-model="selected" @change="selectProject">
          <ElOption value="" label="请选择" />
          <ElOption
            v-for="project in projects"
            :key="project.id"
            :value="project.id"
            :label="project.name"
          /> </ElSelect
      ></label>
      <template v-if="selected"
        ><label>项目名称<ElInput v-model="name" maxlength="80" /></label>
        <div class="actions">
          <ElButton :disabled="busy" @click="operate('rename')">保存名称</ElButton
          ><ElButton :disabled="busy" @click="operate('inspect')">检查项目</ElButton
          ><ElButton :disabled="busy" @click="operate('install')">安装锁定依赖</ElButton
          ><ElButton :disabled="busy" @click="operate('validate')">校验项目</ElButton
          ><ElButton :disabled="busy || status.status === 'running'" @click="startProject"
            >使用此项目托管联机对战</ElButton
          ><ElButton :disabled="busy" @click="operate('forget')">移出列表</ElButton>
        </div>
        <ElCheckbox v-model="offline">仅离线安装</ElCheckbox
        ><ElCheckbox v-model="trusted">我信任此项目的代码及依赖，允许其在本机运行</ElCheckbox
        ><ElButton :disabled="busy || !trusted" @click="operate('approve')">准入此项目</ElButton
        ><ElCheckbox v-model="includeLocal">导出时包含有权再分发的本地 tgz</ElCheckbox>
        <div class="actions">
          <ElButton :disabled="busy" @click="operate('export')">导出到新目录</ElButton
          ><ElButton :disabled="busy" @click="operate('verify')">验证导出项目</ElButton>
        </div></template
      >
    </details>
  </main>
</template>
<style scoped>
.local-service {
  max-width: 960px;
  margin: auto;
  padding: 28px 20px;
  color: #243042;
}
h1 {
  font-size: 26px;
  font-weight: 600;
}
h2 {
  font-size: 18px;
  font-weight: 600;
}
section,
details {
  background: #fff;
  border: 1px solid #dce2ea;
  border-radius: 8px;
  padding: 20px;
  margin-top: 20px;
}
p {
  margin: 12px 0;
  line-height: 1.6;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 14px 0;
}
label {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 15px 0;
}
input:not([type='checkbox']),
select {
  max-width: 100%;
}
.error {
  color: #a92f37;
}
summary {
  cursor: pointer;
  font-weight: 600;
}
</style>
