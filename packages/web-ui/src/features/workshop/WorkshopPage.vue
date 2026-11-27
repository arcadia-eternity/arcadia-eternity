<script setup lang="ts">
import '@/features/management/managementStyles'
import 'element-plus/theme-chalk/el-radio-group.css'
import 'element-plus/theme-chalk/el-radio-button.css'
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElEmpty,
  ElInput,
  ElOption,
  ElRadioButton,
  ElRadioGroup,
  ElSelect,
  ElSkeleton,
  ElTag,
} from 'element-plus'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { WorkshopProject } from '@arcadia-eternity/pack-loader/workshop'
import type { WorkshopRegistryEntry, WorkshopRegistryPreview, WorkshopSummary } from '@/types/workshop'
import { localEnvironmentRequest } from '@/features/content/localEnvironmentPackages'
import { waitForEnvironmentApply } from '@/features/content/waitForEnvironmentApply'
import { createWorkshopSource, workshopError } from './workshopSource'

const props = defineProps<{ source?: ReturnType<typeof createWorkshopSource> }>()
const source = props.source ?? createWorkshopSource()
const router = useRouter()

const registries = ref<WorkshopRegistryEntry[]>([])
const registry = ref('official')
const summary = shallowRef<WorkshopSummary>()
const loading = ref(false)
const error = ref('')
const notice = ref('')
const query = ref('')
const kind = ref<'all' | 'package' | 'environment'>('all')
const selectedId = ref('')
const version = ref('')
const environmentId = ref('')
const installing = ref(false)
const stage = ref('')
const installed = ref<{ packageId?: string; environmentId?: string }>()
let disposed = false
let loadToken = 0

const stageLabels: Record<string, string> = {
  resolving: '解析依赖',
  acquiring: '获取来源',
  installing: '下载并安装',
  verifying: '校验材料',
  capturing: '保存版本材料',
  preparing: '准备环境',
}

const revoked = (npm: string, release: string) =>
  summary.value?.revocations.find(item => item.npm === npm && (item.version === '*' || item.version === release))
const projects = computed(() => {
  const text = query.value.trim().toLowerCase()
  return (summary.value?.projects ?? [])
    .filter(project => kind.value === 'all' || project.kind === kind.value)
    .filter(
      project =>
        !text ||
        [project.title, project.summary, project.npm, project.id, ...project.tags, ...project.authors].some(value =>
          value.toLowerCase().includes(text),
        ),
    )
    .sort((a, b) => Number(b.featured) - Number(a.featured) || a.title.localeCompare(b.title))
})
const selected = computed(() => summary.value?.projects.find(project => project.id === selectedId.value))
const latest = (project: WorkshopProject) => project.releases.find(release => !revoked(project.npm, release.version))
const release = computed(() => selected.value?.releases.find(item => item.version === version.value))
const releaseRevoked = computed(() =>
  selected.value && release.value ? revoked(selected.value.npm, release.value.version) : undefined,
)
const stale = computed(() => summary.value?.freshness === 'stale')
const environmentIdInvalid = computed(
  () => !!environmentId.value.trim() && !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(environmentId.value.trim()),
)

watch(selected, project => {
  version.value = project ? (latest(project)?.version ?? project.releases[0]?.version ?? '') : ''
  environmentId.value = ''
  installed.value = undefined
})

async function load(refresh: boolean) {
  const token = ++loadToken
  loading.value = true
  error.value = ''
  try {
    const next = await source.view(registry.value, refresh)
    if (disposed || token !== loadToken) return
    summary.value = next
    if (next.error) error.value = workshopError(next.error)
    if (selectedId.value && !next.projects.some(project => project.id === selectedId.value)) selectedId.value = ''
  } catch (cause) {
    if (!disposed && token === loadToken) error.value = workshopError(cause)
  } finally {
    if (token === loadToken) loading.value = false
  }
}
async function loadRegistries() {
  registries.value = await source.registries()
  if (!registries.value.some(item => item.id === registry.value)) registry.value = 'official'
}
watch(registry, () => {
  summary.value = undefined
  selectedId.value = ''
  void load(false)
})

async function install() {
  const project = selected.value
  if (!project || !release.value || installing.value) return
  installing.value = true
  error.value = ''
  notice.value = ''
  stage.value = ''
  try {
    const target = environmentId.value.trim()
    const result = await source.install({
      action: 'install',
      ...(registry.value !== 'official' && { registry: registry.value }),
      npm: project.npm,
      version: release.value.version,
      ...(project.kind === 'environment' && target && { environmentId: target }),
    })
    if ('packageId' in result) {
      installed.value = { packageId: result.packageId }
    } else {
      type Job = {
        id: string
        status: string
        error?: unknown
        progress?: { stage: string }
        result?: { environmentId?: string }
      }
      const job = await waitForEnvironmentApply(
        async () => {
          const snapshot = await localEnvironmentRequest<{ operations: Job[] }>({ action: 'snapshot' })
          const current = snapshot.operations.find(item => item.id === result.operationId)
          if (current?.progress?.stage) stage.value = current.progress.stage
          return current
        },
        () => !disposed,
      )
      if (disposed) return
      installed.value = { environmentId: job?.result?.environmentId }
    }
    notice.value = `已安装 ${project.title} ${release.value.version}`
  } catch (cause) {
    if (!disposed) error.value = workshopError(cause)
  } finally {
    installing.value = false
    stage.value = ''
  }
}

const registryDialog = ref(false)
const site = ref('')
const preview = ref<WorkshopRegistryPreview>()
const registryBusy = ref(false)
const registryError = ref('')
function openRegistries() {
  site.value = ''
  preview.value = undefined
  registryError.value = ''
  registryDialog.value = true
}
async function registryAction(run: () => Promise<void>) {
  if (registryBusy.value) return
  registryBusy.value = true
  registryError.value = ''
  try {
    await run()
  } catch (cause) {
    registryError.value = workshopError(cause)
  } finally {
    registryBusy.value = false
  }
}
const previewRegistry = () =>
  registryAction(async () => {
    preview.value = undefined
    preview.value = await source.preview(site.value.trim())
  })
const addRegistry = () =>
  registryAction(async () => {
    const id = await source.addRegistry(site.value.trim(), preview.value!.fingerprint)
    await loadRegistries()
    preview.value = undefined
    site.value = ''
    registry.value = id
  })
const removeRegistry = (id: string) =>
  registryAction(async () => {
    await source.removeRegistry(id)
    if (registry.value === id) registry.value = 'official'
    await loadRegistries()
  })

const date = (value?: string) => (value ? new Date(value).toLocaleString() : '')
const kindLabel = (value: string) => (value === 'environment' ? '环境' : '内容包')

onMounted(async () => {
  try {
    await loadRegistries()
  } catch (cause) {
    error.value = workshopError(cause)
  }
  await load(false)
  // A cached view lists projects immediately; installs still need a fresh index.
  if (!disposed && summary.value?.freshness === 'stale' && !summary.value.error) await load(true)
})
onBeforeUnmount(() => {
  disposed = true
})
</script>

<template>
  <div class="workshop-page" :aria-busy="loading || installing">
    <header class="workshop-header">
      <h1>创意工坊</h1>
      <div class="workshop-toolbar">
        <ElSelect
          v-if="registries.length > 1"
          v-model="registry"
          aria-label="工坊源"
          class="registry-select"
          :disabled="installing"
        >
          <ElOption
            v-for="item in registries"
            :key="item.id"
            :value="item.id"
            :label="item.official ? '官方' : item.id"
          />
        </ElSelect>
        <ElButton :loading="loading" :disabled="installing" @click="load(true)">刷新</ElButton>
        <ElButton v-if="source.canManageRegistries" :disabled="installing" @click="openRegistries">工坊源</ElButton>
      </div>
    </header>

    <ElAlert v-if="error" type="error" :title="error" role="alert" :closable="false" show-icon />
    <ElAlert v-if="notice" type="success" :title="notice" role="status" :closable="false" show-icon>
      <ElButton
        v-if="installed?.packageId"
        link
        type="primary"
        @click="router.push({ path: '/environments', query: { target: 'local', packageId: installed.packageId } })"
        >加入环境</ElButton
      >
      <ElButton v-else-if="installed" link type="primary" @click="router.push('/environments')">查看环境</ElButton>
    </ElAlert>
    <ElAlert
      v-for="item in summary?.revokedInstalled ?? []"
      :key="item.packageId + item.name + item.version"
      type="warning"
      :title="`已安装的 ${item.name} ${item.version} 已被撤销：${item.reason}`"
      role="alert"
      :closable="false"
      show-icon
    />

    <p v-if="summary" class="workshop-status" aria-label="索引状态">
      <ElTag v-if="stale" type="warning" size="small">离线</ElTag>
      快照 {{ summary.snapshot }} · {{ date(summary.checkedAt) }} · 有效期至 {{ date(summary.expires) }}
    </p>

    <div class="workshop-filters">
      <ElInput v-model="query" clearable placeholder="搜索" aria-label="搜索工坊" class="workshop-search" />
      <ElRadioGroup v-model="kind" aria-label="类型">
        <ElRadioButton value="all">全部</ElRadioButton>
        <ElRadioButton value="package">内容包</ElRadioButton>
        <ElRadioButton value="environment">环境</ElRadioButton>
      </ElRadioGroup>
    </div>

    <ElSkeleton v-if="!summary && loading" :rows="6" animated />
    <div v-else-if="summary" class="workshop-body">
      <ul class="workshop-list" aria-label="工坊项目">
        <li v-for="project in projects" :key="project.id">
          <button
            type="button"
            class="workshop-item"
            :class="{ active: project.id === selectedId }"
            :aria-pressed="project.id === selectedId"
            @click="selectedId = project.id"
          >
            <span class="item-title">
              <strong>{{ project.title }}</strong>
              <ElTag size="small" :type="project.kind === 'environment' ? 'success' : 'info'">{{
                kindLabel(project.kind)
              }}</ElTag>
              <ElTag v-if="project.official" size="small" type="primary">官方</ElTag>
            </span>
            <span class="item-summary">{{ project.summary }}</span>
            <span class="item-meta">{{ project.authors.join('、') }} · {{ latest(project)?.version ?? '已撤销' }}</span>
          </button>
        </li>
        <ElEmpty v-if="!projects.length" :image-size="64" description="没有匹配的项目" />
      </ul>

      <section v-if="selected" class="workshop-detail" :aria-label="selected.title">
        <h2>{{ selected.title }}</h2>
        <p>{{ selected.summary }}</p>
        <dl>
          <dt>npm</dt>
          <dd>
            <code>{{ selected.npm }}</code>
          </dd>
          <dt>作者</dt>
          <dd>{{ selected.authors.join('、') }}</dd>
          <template v-if="selected.license">
            <dt>许可</dt>
            <dd>{{ selected.license }}</dd>
          </template>
          <dt>源码</dt>
          <dd>
            <a :href="'https://github.com/' + selected.repository" target="_blank" rel="noopener noreferrer">{{
              selected.repository
            }}</a>
          </dd>
          <template v-if="selected.tags.length">
            <dt>标签</dt>
            <dd class="tags">
              <ElTag v-for="tag in selected.tags" :key="tag" size="small" effect="plain">{{ tag }}</ElTag>
            </dd>
          </template>
        </dl>

        <label class="field">
          <span>版本</span>
          <ElSelect v-model="version" aria-label="版本" :disabled="installing">
            <ElOption
              v-for="item in selected.releases"
              :key="item.version"
              :value="item.version"
              :label="item.version + (revoked(selected.npm, item.version) ? '（已撤销）' : '')"
            />
          </ElSelect>
        </label>
        <dl v-if="release">
          <dt>发布时间</dt>
          <dd>{{ date(release.publishedAt) }}</dd>
          <template v-if="release.arcadia">
            <dt>兼容</dt>
            <dd>Arcadia {{ release.arcadia }}</dd>
          </template>
          <template v-if="Object.keys(release.dependencies).length">
            <dt>依赖</dt>
            <dd>
              <span v-for="(range, name) in release.dependencies" :key="name" class="dependency"
                >{{ name }} {{ range }}</span
              >
            </dd>
          </template>
          <dt>构建来源</dt>
          <dd>
            <a
              :href="`https://github.com/${release.provenance.repository}/commit/${release.provenance.commit}`"
              target="_blank"
              rel="noopener noreferrer"
              >{{ release.provenance.repository }}@{{ release.provenance.commit.slice(0, 7) }}</a
            >
          </dd>
        </dl>
        <ElAlert
          v-if="release?.containsCode"
          type="warning"
          title="包含效果代码，需在环境中授权后才会运行"
          :closable="false"
          show-icon
        />
        <ElAlert
          v-if="releaseRevoked"
          type="error"
          :title="'已撤销：' + releaseRevoked.reason"
          :closable="false"
          show-icon
        />

        <template v-if="source.canInstall">
          <label v-if="selected.kind === 'environment'" class="field">
            <span>环境标识</span>
            <ElInput
              v-model="environmentId"
              :placeholder="selected.npm.split('/').pop()"
              aria-label="环境标识"
              :disabled="installing"
            />
          </label>
          <p v-if="environmentIdInvalid" role="alert" class="field-error">
            须以小写字母或数字开头，可包含短横线或下划线，最多 80 个字符。
          </p>
          <ElButton
            type="primary"
            :loading="installing"
            :disabled="!release || !!releaseRevoked || stale || environmentIdInvalid"
            @click="install"
          >
            {{ installing ? stageLabels[stage] || '安装中' : '安装 ' + version }}
          </ElButton>
        </template>
        <ElButton v-else @click="router.push('/download')">下载客户端以安装</ElButton>
      </section>
    </div>

    <ElDialog v-model="registryDialog" title="工坊源" width="min(560px, 92vw)">
      <ElAlert v-if="registryError" type="error" :title="registryError" role="alert" :closable="false" show-icon />
      <ul class="registry-list" aria-label="已添加的工坊源">
        <li v-for="item in registries" :key="item.id">
          <span>
            <strong>{{ item.official ? '官方' : item.id }}</strong>
            <small>{{ item.site }}</small>
            <code v-if="item.fingerprint">{{ item.fingerprint }}</code>
          </span>
          <ElButton v-if="!item.official" size="small" :disabled="registryBusy" @click="removeRegistry(item.id)"
            >移除</ElButton
          >
        </li>
      </ul>
      <form class="registry-add" @submit.prevent="previewRegistry">
        <ElInput
          v-model="site"
          placeholder="https://example.org/workshop/"
          aria-label="工坊源地址"
          :disabled="registryBusy"
          @input="preview = undefined"
        />
        <ElButton native-type="submit" :loading="registryBusy && !preview" :disabled="!site.trim()"
          >读取根密钥</ElButton
        >
      </form>
      <section v-if="preview" class="registry-preview" aria-label="根密钥">
        <dl>
          <dt>标识</dt>
          <dd>{{ preview.id }}</dd>
          <dt>指纹</dt>
          <dd>
            <code>{{ preview.fingerprint }}</code>
          </dd>
          <dt>有效期至</dt>
          <dd>{{ date(preview.expires) }}</dd>
          <template v-if="preview.mirrors.length">
            <dt>镜像</dt>
            <dd>{{ preview.mirrors.join('、') }}</dd>
          </template>
        </dl>
        <ElAlert type="warning" title="请向发布者核对指纹后再信任" :closable="false" show-icon />
        <ElButton type="primary" :loading="registryBusy" @click="addRegistry">信任此工坊源</ElButton>
      </section>
    </ElDialog>
  </div>
</template>

<style scoped>
.workshop-page {
  display: grid;
  gap: 12px;
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px 16px 80px;
  align-content: start;
}
.workshop-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.workshop-header h1 {
  font-size: 22px;
  font-weight: 600;
}
.workshop-toolbar,
.workshop-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.registry-select {
  width: 160px;
}
.workshop-search {
  max-width: 320px;
}
.workshop-status {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.workshop-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 800px) {
  .workshop-body {
    grid-template-columns: minmax(0, 1fr);
  }
}
.workshop-list {
  display: grid;
  gap: 8px;
  list-style: none;
  padding: 0;
  margin: 0;
}
.workshop-item {
  display: grid;
  gap: 4px;
  width: 100%;
  text-align: left;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color);
  cursor: pointer;
  font: inherit;
}
.workshop-item.active,
.workshop-item:hover {
  border-color: var(--el-color-primary);
}
.item-title {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.item-summary {
  color: var(--el-text-color-regular);
  font-size: 13px;
}
.item-meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.workshop-detail {
  display: grid;
  gap: 12px;
  padding: 18px;
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  background: var(--el-bg-color);
}
.workshop-detail h2 {
  font-size: 18px;
  font-weight: 600;
}
dl {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 6px 14px;
  margin: 0;
  font-size: 13px;
}
dt {
  color: var(--el-text-color-secondary);
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.tags,
.dependency {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.dependency {
  display: block;
}
.field {
  display: grid;
  gap: 6px;
  font-size: 13px;
}
.field-error {
  color: var(--el-color-danger);
  font-size: 12px;
}
.registry-list {
  display: grid;
  gap: 8px;
  list-style: none;
  padding: 0;
  margin: 0 0 12px;
}
.registry-list li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}
.registry-list span {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.registry-list small,
.registry-list code {
  color: var(--el-text-color-secondary);
  overflow-wrap: anywhere;
  font-size: 12px;
}
.registry-add {
  display: flex;
  gap: 8px;
}
.registry-preview {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}
</style>
