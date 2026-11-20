<script setup lang="ts">
import { ElButton, ElCheckbox, ElInput } from 'element-plus'
import { computed, onMounted, ref, shallowRef } from 'vue'
import type { SourceProject } from '@/features/authoring/types'
import { isRemoteContentActive } from '@/i18n/serverContent'
import { useGameDataStore } from '@/stores/gameData'
import type { InstalledContentPackage } from '@/types/contentPackages'
import type { ManagedEnvironment, ManagedEnvironmentInstallation } from '@/types/management'
import { contentTaskError } from '@/utils/contentTaskMessages'
import { installProjectBuild, localEnvironmentRequest } from './localEnvironmentPackages'

const props = defineProps<{ installed?: InstalledContentPackage; project?: SourceProject }>()
interface EnvironmentSnapshot {
  selectedEnvironmentId: string
  environments: ManagedEnvironment[]
  installations: ManagedEnvironmentInstallation[]
  operations: { id: string; status: string; error?: { code?: string; message: string } }[]
}
const snapshot = shallowRef<EnvironmentSnapshot>()
const targets = computed(() => snapshot.value?.environments.filter(item => !item.builtin) ?? [])
const base = computed(() => snapshot.value?.environments.find(item => item.builtin))
const gameData = useGameDataStore()
const pendingId = ref('')
const phase = ref('')
const completedId = ref('')
const error = ref('')
const creating = ref(false)
const newName = ref('')
const allowDownload = ref(false)
const showDownloadOption = ref(false)

async function refresh() {
  const result = await localEnvironmentRequest<EnvironmentSnapshot>({ action: 'snapshot' })
  snapshot.value = result
  return result
}
async function load() {
  error.value = ''
  try {
    await refresh()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法读取本地环境'
  }
}
onMounted(load)

function installedMember(target: ManagedEnvironment) {
  const pkg = props.installed
  if (!pkg) return
  const installation = snapshot.value?.installations.find(
    item =>
      item.status === 'ready' && item.environmentId === target.document.id && item.draftRevision === target.revision,
  )
  if (installation?.status === 'ready') return installation.members?.find(item => item.name === pkg.name && item.direct)
}
const rows = computed(() =>
  targets.value.map(target => {
    const member = installedMember(target)
    const included = !!member && member.version === props.installed?.version
    return { target, member, included }
  }),
)

async function add(target?: ManagedEnvironment) {
  if (pendingId.value || (!target && (!base.value || !newName.value.trim()))) return
  const id = target?.document.id ?? 'local-' + crypto.randomUUID()
  const name = target?.document.name ?? newName.value.trim()
  const seed = base.value
  pendingId.value = id
  completedId.value = ''
  error.value = ''
  try {
    phase.value = '正在构建'
    const pkg = props.project ? await installProjectBuild(props.project.id) : props.installed
    if (!pkg) throw new Error('找不到本地内容包')
    phase.value = '正在加入'
    const input = target
      ? {
          action: 'add-package',
          environmentId: id,
          expectedRevision: target.revision,
          name: pkg.name,
          version: pkg.version,
        }
      : {
          action: 'apply',
          copyFrom: seed!.document.id,
          expectedRevision: null,
          document: {
            ...seed!.document,
            id,
            name,
            packages: { ...seed!.document.packages, [pkg.name]: pkg.version },
            sources: seed!.document.sources.filter(source => source !== pkg.name),
          },
        }
    const { operationId } = await localEnvironmentRequest<{ operationId: string }>({
      ...input,
      allowDownload: allowDownload.value,
    })
    for (;;) {
      const state = await refresh()
      const operation = state.operations.find(job => job.id === operationId)
      if (operation?.status === 'succeeded') {
        completedId.value = id
        creating.value = false
        newName.value = ''
        if (state.selectedEnvironmentId === id && !isRemoteContentActive()) await gameData.reload()
        break
      }
      if (!operation || !['running', 'queued'].includes(operation.status)) {
        throw new Error(contentTaskError(operation?.error) || '任务已结束，请检查环境后重试。')
      }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '加入环境失败'
    showDownloadOption.value = true
    await refresh().catch(() => {})
  } finally {
    pendingId.value = ''
  }
}
</script>
<template>
  <section class="targets" aria-label="加入本地环境">
    <header>
      <h3>加入本地环境</h3>
      <ElButton
        v-if="base && targets.length && !creating"
        link
        type="primary"
        :disabled="!!pendingId"
        @click="creating = true"
        >新建环境</ElButton
      >
    </header>
    <p v-if="!snapshot && !error" role="status">正在读取环境…</p>
    <ul v-if="rows.length">
      <li v-for="{ target, member, included } in rows" :key="target.document.id">
        <span class="target-name"
          >{{ target.document.name }}
          <small v-if="snapshot?.selectedEnvironmentId === target.document.id">当前使用</small>
          <small v-if="member && !included">现有版本 {{ member.version }}</small>
        </span>
        <span v-if="pendingId === target.document.id" role="status">{{ phase }}…</span>
        <span v-else-if="included || completedId === target.document.id" class="success" role="status">已加入</span>
        <ElButton v-else size="small" :disabled="!!pendingId" @click="add(target)">{{
          project ? '构建并加入' : member ? '使用 ' + installed?.version : '加入'
        }}</ElButton>
      </li>
    </ul>
    <form v-if="base && (creating || !targets.length)" @submit.prevent="add()">
      <label
        >新环境名称<ElInput v-model="newName" maxlength="80" aria-label="新环境名称" :disabled="!!pendingId"
      /></label>
      <div>
        <ElButton size="small" type="primary" native-type="submit" :disabled="!!pendingId || !newName.trim()">{{
          pendingId && !targets.some(item => item.document.id === pendingId) ? phase + '…' : '创建并加入'
        }}</ElButton>
        <ElButton v-if="targets.length" size="small" link :disabled="!!pendingId" @click="creating = false"
          >取消</ElButton
        >
      </div>
    </form>
    <p v-if="snapshot && !base && !targets.length">请先在本机环境库新建环境。</p>
    <p v-if="error" role="alert">{{ error }} <ElButton v-if="!snapshot" link @click="load">重试</ElButton></p>
    <ElCheckbox v-if="showDownloadOption" v-model="allowDownload" :disabled="!!pendingId"
      >允许下载缺失的第三方包</ElCheckbox
    >
  </section>
</template>
<style scoped>
.targets {
  margin: 16px 0;
  border-block: 1px solid var(--el-border-color-lighter);
  padding: 12px 0;
}
header,
li,
form > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}
ul {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  max-height: 15rem;
  overflow: auto;
}
li {
  padding: 6px 0;
  min-height: 30px;
  font-size: 13px;
}
.target-name {
  min-width: 0;
  overflow-wrap: anywhere;
}
small {
  display: block;
  color: var(--el-text-color-secondary);
}
[role='status'] {
  font-size: 13px;
  white-space: nowrap;
}
.success {
  color: var(--el-color-success-dark-2);
}
[role='alert'] {
  color: var(--el-color-danger-dark-2);
  overflow-wrap: anywhere;
}
form,
label {
  display: grid;
  gap: 5px;
}
form {
  margin-top: 8px;
  gap: 8px;
  font-size: 13px;
}
form > div {
  justify-content: flex-start;
}
</style>
