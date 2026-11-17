<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { authorCall, type SourceProject } from '@/features/authoring/types'
const router = useRouter()
const projects = ref<SourceProject[]>([])
const query = ref('')
const name = ref('')
const creating = ref(false)
const busy = ref(false)
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
  if (canAuthor) void run(refresh)
})
</script>
<template>
  <section class="projects" aria-label="UGC 项目">
    <header>
      <h2>项目</h2>
      <input v-model="query" type="search" aria-label="搜索项目" placeholder="搜索项目" />
      <template v-if="canAuthor">
        <button :disabled="busy" @click="choose">打开项目文件夹</button>
        <button :disabled="busy" @click="creating = !creating">新建内容包</button>
      </template>
    </header>
    <p v-if="!canAuthor" role="status">编辑项目需要桌面客户端。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <form v-if="creating" @submit.prevent="create">
      <label>内容包名称<input v-model="name" required maxlength="80" /></label>
      <button :disabled="busy || !name.trim()">创建并打开</button>
      <button type="button" @click="creating = false">取消</button>
    </form>
    <ul>
      <li v-for="project in visible" :key="project.id">
        <button class="project" :disabled="busy" @click="open(project)">
          <strong>{{ project.name }}</strong>
        </button>
        <button
          :disabled="busy"
          @click="
            run(async () => {
              await authorCall({ action: 'export', id: project.id })
            })
          "
        >
          导出源码
        </button>
        <button :disabled="busy" title="保留源文件" @click="forget(project)">从列表移除</button>
      </li>
    </ul>
  </section>
</template>
<style scoped>
.projects {
  padding: 12px 20px 24px;
}
header,
form,
li {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
header {
  margin-bottom: 16px;
}
h2 {
  margin-right: auto;
  font-size: 18px;
  font-weight: 600;
}
ul {
  padding: 0;
  list-style: none;
}
li {
  border-bottom: 1px solid var(--el-border-color-light);
  padding: 12px 0;
}
.project {
  flex: 1;
  text-align: left;
  min-width: 160px;
}
button,
input {
  font: inherit;
  padding: 8px 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-bg-color);
  color: inherit;
}
button:disabled {
  opacity: 0.5;
}
label {
  display: flex;
  align-items: center;
  gap: 8px;
}
[role='alert'] {
  color: var(--el-color-danger);
}
</style>
