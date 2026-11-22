<script setup lang="ts">
import '@/features/management/managementStyles'
import { ElButton, ElMessageBox, ElInput, ElDialog, ElForm, ElFormItem, ElAlert } from 'element-plus'
import { computed, onMounted, ref } from 'vue'
import ContentPackagesPanel from './ContentPackagesPanel.vue'
import CreatorGitHubPanel from '@/features/authoring/CreatorGitHubPanel.vue'
import { useRouter } from 'vue-router'
import { authorCall, type SourceProject } from '@/features/authoring/types'
import { useNewPackageRange } from '@/features/authoring/useNewPackageRange'
const { arcadiaRange, defaultRange, rangeError } = useNewPackageRange()
const router = useRouter()
const projects = ref<SourceProject[]>([])
const name = ref('')
const creating = ref(false)
const cloning = ref(false)
const githubOpen = ref(false)
const busy = ref(false)
const initialized = ref(false)
const error = ref('')
const canAuthor = !!window.arcadiaDesktop?.author
const canShowTerminal = canAuthor && import.meta.env.PROD
const terminalOpen = ref(false)
const commandNames = ['arcadia', 'arcadia-content'] as const
type CommandName = (typeof commandNames)[number]
interface TerminalPaths {
  shell: 'posix' | 'powershell'
  commandPaths: Record<CommandName, string>
}
const terminal = ref<TerminalPaths>()
const commandFields = ref<HTMLInputElement[]>([])
const copyNotice = ref('')
const commands = computed(() => {
  if (!terminal.value) return []
  const { shell, commandPaths } = terminal.value
  return commandNames.map(name => {
    const path = commandPaths[name]
    const invocation =
      shell === 'powershell' ? "& '" + path.replaceAll("'", "''") + "'" : "'" + path.replaceAll("'", "'\\''") + "'"
    return { name, path, line: invocation + ' --help' }
  })
})
const editable = computed(() => projects.value.filter(project => !project.readOnly))
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
  if (rangeError.value) return
  await run(async () =>
    open(
      await authorCall<SourceProject>({
        action: 'create',
        name: name.value.trim(),
        arcadiaRange: arcadiaRange.value.trim(),
      }),
    ),
  )
}
async function cloneProject() {
  try {
    const { value } = await ElMessageBox.prompt('HTTPS 仓库地址', '克隆源项目', {
      inputPlaceholder: 'https://',
      confirmButtonText: '克隆并打开',
      cancelButtonText: '取消',
    })
    cloning.value = true
    try {
      await run(async () => open(await authorCall<SourceProject>({ action: 'clone', url: value })))
    } finally {
      cloning.value = false
    }
  } catch (cause) {
    if (cause !== 'cancel' && cause !== 'close') error.value = String(cause)
  }
}
async function choose() {
  await run(async () => {
    const project = await authorCall<SourceProject | null>({ action: 'open' })
    if (project) await open(project)
  })
}
async function showTerminalCommands() {
  await run(async () => {
    terminal.value = await authorCall<TerminalPaths>({ action: 'terminal-command-paths' })
    copyNotice.value = ''
    terminalOpen.value = true
  })
}
async function copyCommand(name: CommandName, line: string) {
  try {
    await navigator.clipboard.writeText(line)
    copyNotice.value = '已复制 ' + name + ' 命令'
  } catch {
    const field = commandFields.value.find(field => field.name === name)
    field?.focus()
    field?.select()
    copyNotice.value = '请手动复制所选命令。'
  }
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
  <section class="creation-page" aria-labelledby="creation-title" :aria-busy="busy">
    <h1 id="creation-title">内容包与创作</h1>
    <ElAlert v-if="error" :title="error" type="error" :closable="false" role="alert" />
    <section v-if="canAuthor && githubOpen" class="github-clone" aria-label="从 GitHub 打开">
      <CreatorGitHubPanel mode="clone" @cloned="open" />
    </section>
    <ContentPackagesPanel
      location="local"
      :projects="editable"
      :projects-loading="!initialized"
      @refresh-projects="canAuthor && run(refresh)"
    >
      <template v-if="canAuthor" #toolbar>
        <ElButton type="primary" :disabled="busy" @click="creating = true">新建内容包</ElButton>
        <ElButton :disabled="busy" @click="choose">打开项目文件夹</ElButton>
        <ElButton :aria-expanded="githubOpen" @click="githubOpen = !githubOpen">从 GitHub 打开</ElButton>
        <ElButton :disabled="busy" @click="cloneProject">克隆源项目</ElButton>
        <ElButton v-if="canShowTerminal" :disabled="busy" @click="showTerminalCommands">终端命令</ElButton>
        <ElButton v-if="cloning" @click="authorCall({ action: 'git-cancel', id: 'clone' })">取消克隆</ElButton>
      </template>
      <template #project-detail="{ project }">
        <p class="project-path">{{ project.directory }}</p>
        <div class="project-actions">
          <ElButton type="primary" :disabled="busy" @click="open(project)">编辑项目</ElButton>
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
      </template>
    </ContentPackagesPanel>
    <ElDialog
      v-model="terminalOpen"
      append-to-body
      :title="terminal?.shell === 'powershell' ? '终端命令（PowerShell）' : '终端命令'"
      width="min(42rem, 92vw)"
    >
      <section v-for="command in commands" :key="command.name" class="terminal-command">
        <div class="command-actions">
          <h3>{{ command.name === 'arcadia' ? '对战与服务器' : '内容创作' }}</h3>
          <ElButton :aria-label="'复制 ' + command.name + ' 命令'" @click="copyCommand(command.name, command.line)"
            >复制命令</ElButton
          >
        </div>
        <code class="command-path" tabindex="0">{{ command.path }}</code>
        <input
          ref="commandFields"
          class="command-line"
          :name="command.name"
          :aria-label="command.name + ' 帮助命令'"
          :value="command.line"
          readonly
        />
      </section>
      <p v-if="copyNotice" role="status">{{ copyNotice }}</p>
    </ElDialog>
    <ElDialog
      v-model="creating"
      append-to-body
      title="新建内容包"
      @closed="arcadiaRange = defaultRange"
      width="min(440px, calc(100vw - 32px))"
      :close-on-click-modal="false"
    >
      <ElForm label-position="top" @submit.prevent="create">
        <ElFormItem label="内容包名称">
          <ElInput v-model="name" aria-label="内容包名称" placeholder="给内容包起个名字" maxlength="80" />
        </ElFormItem>
        <ElFormItem label="Arcadia 兼容范围" :error="rangeError">
          <ElInput v-model="arcadiaRange" aria-label="Arcadia 兼容范围" maxlength="256" />
        </ElFormItem>
        <div class="dialog-actions">
          <ElButton :disabled="busy" @click="creating = false">取消</ElButton>
          <ElButton type="primary" native-type="submit" :loading="busy" :disabled="!name.trim() || !!rangeError"
            >创建并打开</ElButton
          >
        </div>
      </ElForm>
    </ElDialog>
  </section>
</template>
<style scoped>
.creation-page {
  max-width: 1280px;
  margin: 0 auto;
}
.github-clone {
  margin: 12px 20px;
  padding: 14px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
}
.creation-page h1 {
  margin: 16px clamp(12px, 2vw, 20px) 4px;
  font-size: 24px;
  font-weight: 600;
}
.terminal-command + .terminal-command {
  margin-top: 20px;
}
.command-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.command-actions h3 {
  margin: 0;
  font-size: 1rem;
}
.command-path {
  display: block;
  margin: 6px 0;
  overflow-wrap: anywhere;
  user-select: all;
}
.command-line {
  box-sizing: border-box;
  width: 100%;
  padding: 7px 10px;
  font-family: monospace;
  color: var(--el-text-color-primary);
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
}
.project-path {
  overflow-wrap: anywhere;
  margin-block: 8px;
}
.project-actions,
.dialog-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.project-actions :deep(.el-button) {
  margin: 0;
}
.dialog-actions {
  justify-content: flex-end;
}
</style>
