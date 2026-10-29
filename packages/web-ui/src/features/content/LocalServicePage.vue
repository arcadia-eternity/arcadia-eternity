<script setup lang="ts">
import { onMounted, ref } from 'vue'
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
async function refresh() {
  library.value = await api?.listContentPackages?.()
  projects.value = (await api?.listContentProjects?.()) ?? []
  status.value = (await api?.getLocalBattleStatus?.()) ?? { status: 'idle' }
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
async function start() {
  await run(async () => {
    await api!.contentPackageAction!({ action: 'start' })
    await refresh()
    notice.value = '本机服务已启动'
  })
}
async function stop() {
  await run(async () => {
    await api!.stopLocalBattle!()
    await refresh()
    notice.value = '本机服务已停止'
  })
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
onMounted(() => void run(refresh))
</script>
<template>
  <main class="local-service">
    <h1>高级本机工具</h1>
    <p>内容会根据你的选择自动准备。这里提供诊断与已有服务器项目的管理工具。</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <details>
      <summary>本机运行诊断</summary>
      <h2>当前可用内容</h2>
      <p>
        官方基础内容<span
          v-for="pkg in library?.packages.filter(pkg => library?.activeIds.includes(pkg.id))"
          :key="pkg.id"
          >、{{ pkg.title }} {{ pkg.version }}</span
        >
      </p>
      <p>正常启停和版本切换由客户端自动处理，无需在这里操作。</p>
      <p v-if="status.status === 'running'">运行中：{{ status.url }}</p>
      <p v-else-if="status.status === 'failed'" class="error">{{ status.message }}</p>
      <p v-else>服务未运行</p>
      <div class="actions">
        <button :disabled="busy || !library?.hasSelection || status.status === 'running'" @click="start">
          启动本机服务</button
        ><button :disabled="busy || status.status !== 'running'" @click="stop">停止本机服务</button
        ><button :disabled="busy" @click="run(refresh)">刷新状态</button>
      </div>
      <p v-if="!library?.hasSelection">在内容包页选择需要的内容，客户端会自动准备。</p>
    </details>
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
          ><button :disabled="busy || status.status === 'running'" @click="operate('start')">启动此项目</button
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
