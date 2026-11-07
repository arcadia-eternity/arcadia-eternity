<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { ContentProjectSummary, ContentProjectAction, LocalBattleHostStatus } from '@/types/desktop'
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
    const result = await api!.localServer!({ action: 'start-project', projectId: selected.value })
    if (result.error) throw new Error(result.error.message)
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
    <p>内容会根据你的选择自动准备。这里提供诊断与已有服务器项目的管理工具。</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p><RouterLink to="/servers">开服、连接地址与服务器设置已移至“服务器”页面</RouterLink></p>
    <details>
      <summary>高级服务器项目管理</summary>
      <p>兼容已有的 npm 服务器项目。普通内容包管理不需要手动登记项目目录。</p>
      <button :disabled="busy" @click="add">登记项目目录</button
      ><label
        >已有项目<select v-model="selected" @change="selectProject">
          <option value="">请选择</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
        </select></label
      >
      <template v-if="selected"
        ><label>项目名称<input v-model="name" maxlength="80" /></label>
        <div class="actions">
          <button :disabled="busy" @click="operate('rename')">保存名称</button
          ><button :disabled="busy" @click="operate('inspect')">检查项目</button
          ><button :disabled="busy" @click="operate('install')">安装锁定依赖</button
          ><button :disabled="busy" @click="operate('validate')">校验项目</button
          ><button :disabled="busy || status.status === 'running'" @click="startProject">使用此项目托管联机对战</button
          ><button :disabled="busy" @click="operate('forget')">移出列表</button>
        </div>
        <label><input v-model="offline" type="checkbox" />仅离线安装</label
        ><label><input v-model="trusted" type="checkbox" />我信任此项目的代码及依赖，允许其在本机运行</label
        ><button :disabled="busy || !trusted" @click="operate('approve')">准入此项目</button
        ><label><input v-model="includeLocal" type="checkbox" />导出时包含有权再分发的本地 tgz</label>
        <div class="actions">
          <button :disabled="busy" @click="operate('export')">导出到新目录</button
          ><button :disabled="busy" @click="operate('verify')">验证导出项目</button>
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
button,
input,
select {
  font: inherit;
  border: 1px solid #bcc7d4;
  border-radius: 5px;
  background: white;
  padding: 8px 10px;
}
button {
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
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
