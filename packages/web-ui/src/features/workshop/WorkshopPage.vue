<script setup lang="ts">
import '@/features/management/managementStyles'
import {
  ElAlert,
  ElButton,
  ElDialog,
  ElDrawer,
  ElEmpty,
  ElIcon,
  ElInput,
  ElOption,
  ElSelect,
  ElSkeleton,
  ElTag,
} from 'element-plus'
import {
  Box,
  CircleCheckFilled,
  Connection,
  Cpu,
  Download,
  Grid,
  Link,
  Refresh,
  Search,
  Shop,
  WarningFilled,
} from '@element-plus/icons-vue'
import { useMediaQuery } from '@vueuse/core'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { WorkshopProject } from '@arcadia-eternity/pack-loader/workshop'
import type { WorkshopRegistryEntry, WorkshopRegistryPreview, WorkshopSummary } from '@/types/workshop'
import { localEnvironmentRequest } from '@/features/content/localEnvironmentPackages'
import { waitForEnvironmentApply } from '@/features/content/waitForEnvironmentApply'
import WorkshopCover from './WorkshopCover.vue'
import { formatDate, formatSize, formatTime, kindLabel, revocation, visibleTags } from './workshopFormat'
import { createWorkshopSource, workshopError } from './workshopSource'

const props = defineProps<{ source?: ReturnType<typeof createWorkshopSource> }>()
const source = props.source ?? createWorkshopSource()
const router = useRouter()
const compact = useMediaQuery('(max-width: 720px)')

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

const kinds = [
  { value: 'all', label: '全部', icon: Shop },
  { value: 'package', label: '内容包', icon: Box },
  { value: 'environment', label: '环境', icon: Grid },
] as const
const stageLabels: Record<string, string> = {
  resolving: '解析依赖',
  acquiring: '获取来源',
  installing: '下载中',
  verifying: '校验中',
  capturing: '保存材料',
  preparing: '准备环境',
}

const revoked = (npm: string, release: string) => revocation(summary.value?.revocations ?? [], npm, release)
const matching = computed(() => {
  const text = query.value.trim().toLowerCase()
  return (summary.value?.projects ?? [])
    .filter(
      project =>
        !text ||
        [project.title, project.summary, project.npm, project.id, ...project.tags, ...project.authors].some(value =>
          value.toLowerCase().includes(text),
        ),
    )
    .sort((a, b) => Number(b.featured) - Number(a.featured) || a.title.localeCompare(b.title, 'zh-CN'))
})
const counts = computed(() => ({
  all: matching.value.length,
  package: matching.value.filter(project => project.kind === 'package').length,
  environment: matching.value.filter(project => project.kind === 'environment').length,
}))
const projects = computed(() => matching.value.filter(project => kind.value === 'all' || project.kind === kind.value))
const selected = computed(() => summary.value?.projects.find(project => project.id === selectedId.value))
const latest = (project: WorkshopProject) => project.releases.find(release => !revoked(project.npm, release.version))
const release = computed(() => selected.value?.releases.find(item => item.version === version.value))
const releaseRevoked = computed(() =>
  selected.value && release.value ? revoked(selected.value.npm, release.value.version) : undefined,
)
const stale = computed(() => summary.value?.freshness === 'stale')
const environmentIdInvalid = computed(
  () =>
    !!environmentId.value.trim() &&
    (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(environmentId.value.trim()) || environmentId.value.trim() === 'default'),
)
const drawerOpen = computed({
  get: () => !!selected.value,
  set: open => {
    if (!open && !installing.value) selectedId.value = ''
  },
})
const registryName = (item: WorkshopRegistryEntry) => (item.official ? '官方' : item.id)

watch(selected, project => {
  version.value = project ? (latest(project)?.version ?? project.releases[0]?.version ?? '') : ''
  environmentId.value = ''
  installed.value = undefined
  notice.value = ''
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
  <main class="workshop" :aria-busy="loading || installing">
    <header class="workshop-heading">
      <div class="heading-title">
        <ElIcon><Shop /></ElIcon>
        <h1>创意工坊</h1>
      </div>
      <div class="heading-tools">
        <ElSelect
          v-if="registries.length > 1"
          v-model="registry"
          aria-label="工坊源"
          class="registry-select"
          :disabled="installing"
        >
          <ElOption v-for="item in registries" :key="item.id" :value="item.id" :label="registryName(item)" />
        </ElSelect>
        <ElButton v-if="source.canManageRegistries" :icon="Connection" :disabled="installing" @click="openRegistries"
          >工坊源</ElButton
        >
        <ElButton
          :icon="Refresh"
          :loading="loading"
          :disabled="installing"
          aria-label="刷新"
          :title="summary?.checkedAt ? '更新于 ' + formatTime(summary.checkedAt) : undefined"
          @click="load(true)"
          >刷新</ElButton
        >
      </div>
    </header>

    <div class="workshop-body">
      <div class="workshop-content">
        <ElAlert v-if="error && !selected" type="error" :title="error" role="alert" :closable="false" show-icon />
        <ElAlert
          v-if="stale && !error"
          type="warning"
          :title="'离线 · ' + formatTime(summary?.checkedAt)"
          role="status"
          :closable="false"
          show-icon
        />
        <ElAlert
          v-for="item in summary?.revokedInstalled ?? []"
          :key="item.packageId + item.name + item.version"
          type="warning"
          :title="`${item.name} ${item.version} 已撤销 · ${item.reason}`"
          role="alert"
          :closable="false"
          show-icon
        />

        <div class="workshop-filters">
          <ElInput
            v-model="query"
            clearable
            placeholder="搜索名称、作者或标签"
            aria-label="搜索工坊"
            class="workshop-search"
            size="large"
            :prefix-icon="Search"
          />
          <div class="kind-tabs" role="tablist" aria-label="类型">
            <button
              v-for="item in kinds"
              :key="item.value"
              type="button"
              role="tab"
              class="kind-tab"
              :class="{ active: kind === item.value }"
              :aria-selected="kind === item.value"
              @click="kind = item.value"
            >
              <ElIcon><component :is="item.icon" /></ElIcon>
              {{ item.label }}
              <span class="count">{{ counts[item.value] }}</span>
            </button>
          </div>
        </div>

        <div v-if="!summary && loading" class="workshop-grid" aria-label="正在加载">
          <ElSkeleton v-for="n in 6" :key="n" animated class="card-skeleton">
            <template #template>
              <div class="skeleton-cover" />
              <div class="skeleton-lines"><span /><span /></div>
            </template>
          </ElSkeleton>
        </div>
        <ul v-else-if="projects.length" class="workshop-grid" aria-label="工坊项目">
          <li v-for="project in projects" :key="project.id">
            <button
              type="button"
              class="workshop-card"
              :class="{ active: project.id === selectedId }"
              :aria-pressed="project.id === selectedId"
              @click="selectedId = project.id"
            >
              <WorkshopCover :id="project.id" :title="project.title" :kind="project.kind" />
              <span class="card-body">
                <span class="card-badges">
                  <span class="kind-badge" :class="project.kind">{{ kindLabel(project.kind) }}</span>
                  <span v-if="project.official" class="official-badge">
                    <ElIcon><CircleCheckFilled /></ElIcon>官方
                  </span>
                </span>
                <strong class="card-title">{{ project.title }}</strong>
                <span class="card-summary">{{ project.summary }}</span>
                <span class="card-meta">
                  <span>{{ project.authors.join('、') }}</span>
                  <span class="card-version">{{ latest(project)?.version ?? '已撤销' }}</span>
                </span>
              </span>
            </button>
          </li>
        </ul>
        <ElEmpty v-else-if="summary" :image-size="72" description="没有匹配的项目">
          <ElButton v-if="query || kind !== 'all'" @click="((query = ''), (kind = 'all'))">清除筛选</ElButton>
        </ElEmpty>
      </div>
    </div>

    <ElDrawer
      v-model="drawerOpen"
      :size="compact ? '92%' : 'min(560px, 92vw)'"
      :direction="compact ? 'btt' : 'rtl'"
      :with-header="false"
      append-to-body
      class="workshop-drawer"
    >
      <article v-if="selected" class="detail" :aria-label="selected.title">
        <WorkshopCover :id="selected.id" :title="selected.title" :kind="selected.kind" size="hero" />
        <header class="detail-heading">
          <div class="card-badges">
            <span class="kind-badge" :class="selected.kind">{{ kindLabel(selected.kind) }}</span>
            <span v-if="selected.official" class="official-badge">
              <ElIcon><CircleCheckFilled /></ElIcon>官方
            </span>
          </div>
          <h2>{{ selected.title }}</h2>
          <p v-if="selected.summary">{{ selected.summary }}</p>
          <div v-if="visibleTags(selected).length" class="detail-tags">
            <ElTag v-for="tag in visibleTags(selected)" :key="tag" size="small" effect="plain" round>{{ tag }}</ElTag>
          </div>
        </header>

        <section class="install-box" aria-label="安装">
          <div class="install-row">
            <ElSelect v-model="version" aria-label="版本" :disabled="installing" class="version-select">
              <ElOption
                v-for="item in selected.releases"
                :key="item.version"
                :value="item.version"
                :label="item.version + (revoked(selected.npm, item.version) ? '（已撤销）' : '')"
              />
            </ElSelect>
            <ElButton
              v-if="source.canInstall"
              type="primary"
              :icon="Download"
              :loading="installing"
              :disabled="!release || !!releaseRevoked || stale || environmentIdInvalid"
              class="install-button"
              @click="install"
            >
              {{ installing ? stageLabels[stage] || '安装中' : '安装' }}
            </ElButton>
            <ElButton v-else type="primary" :icon="Download" class="install-button" @click="router.push('/download')"
              >下载客户端</ElButton
            >
          </div>
          <ElInput
            v-if="source.canInstall && selected.kind === 'environment'"
            v-model="environmentId"
            :placeholder="'环境标识 · ' + selected.npm.split('/').pop()"
            aria-label="环境标识"
            :disabled="installing"
          />
          <p v-if="environmentIdInvalid" role="alert" class="field-error">
            {{ environmentId.trim() === 'default' ? 'default 已被内置环境使用' : '小写字母或数字开头，可含 - 和 _' }}
          </p>
          <ElAlert
            v-if="stale && source.canInstall && !error"
            type="warning"
            title="离线，刷新后安装"
            :closable="false"
            show-icon
          />
          <ElAlert v-if="error" type="error" :title="error" role="alert" :closable="false" show-icon />
          <ElAlert v-if="notice" type="success" :title="notice" role="status" :closable="false" show-icon>
            <ElButton
              v-if="installed?.packageId"
              link
              type="primary"
              @click="
                router.push({ path: '/environments', query: { target: 'local', packageId: installed.packageId } })
              "
              >加入环境</ElButton
            >
            <ElButton
              v-else-if="installed"
              link
              type="primary"
              @click="
                router.push({
                  path: '/environments',
                  query: {
                    target: 'local',
                    ...(installed.environmentId && { environmentId: installed.environmentId }),
                  },
                })
              "
              >查看环境</ElButton
            >
          </ElAlert>
        </section>

        <ul v-if="release && (release.containsCode || releaseRevoked)" class="notes">
          <li v-if="releaseRevoked" class="danger">
            <ElIcon><WarningFilled /></ElIcon>已撤销 · {{ releaseRevoked.reason }}
          </li>
          <li v-if="release.containsCode">
            <ElIcon><Cpu /></ElIcon>含效果代码，需在环境中授权
          </li>
        </ul>

        <dl v-if="release" class="facts">
          <div>
            <dt>发布</dt>
            <dd>{{ formatDate(release.publishedAt) }}</dd>
          </div>
          <div v-if="release.arcadia">
            <dt>兼容</dt>
            <dd>Arcadia {{ release.arcadia }}</dd>
          </div>
          <div v-if="release.size">
            <dt>大小</dt>
            <dd>{{ formatSize(release.size) }}</dd>
          </div>
          <div v-if="selected.license">
            <dt>许可</dt>
            <dd>{{ selected.license }}</dd>
          </div>
        </dl>

        <section v-if="release && Object.keys(release.dependencies).length" class="detail-section">
          <h3>依赖</h3>
          <ul class="dependencies">
            <li v-for="(range, name) in release.dependencies" :key="name">
              <code>{{ name }}</code>
              <span>{{ range }}</span>
            </li>
          </ul>
        </section>

        <section class="detail-section">
          <h3>来源</h3>
          <dl class="source-list">
            <dt>作者</dt>
            <dd>{{ selected.authors.join('、') }}</dd>
            <dt>npm</dt>
            <dd>
              <code>{{ selected.npm }}</code>
            </dd>
            <dt>源码</dt>
            <dd>
              <a :href="'https://github.com/' + selected.repository" target="_blank" rel="noopener noreferrer"
                ><ElIcon><Link /></ElIcon>{{ selected.repository }}</a
              >
            </dd>
            <template v-if="release">
              <dt>构建</dt>
              <dd>
                <a
                  :href="`https://github.com/${release.provenance.repository}/commit/${release.provenance.commit}`"
                  target="_blank"
                  rel="noopener noreferrer"
                  ><ElIcon><Link /></ElIcon>{{ release.provenance.commit.slice(0, 7) }}</a
                >
              </dd>
            </template>
          </dl>
        </section>
      </article>
    </ElDrawer>

    <ElDialog v-model="registryDialog" title="工坊源" width="min(560px, 92vw)">
      <ElAlert v-if="registryError" type="error" :title="registryError" role="alert" :closable="false" show-icon />
      <ul class="registry-list" aria-label="已添加的工坊源">
        <li v-for="item in registries" :key="item.id">
          <span>
            <strong>{{ registryName(item) }}</strong>
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
        <dl class="source-list">
          <dt>标识</dt>
          <dd>{{ preview.id }}</dd>
          <dt>指纹</dt>
          <dd>
            <code>{{ preview.fingerprint }}</code>
          </dd>
          <dt>有效期至</dt>
          <dd>{{ formatDate(preview.expires) }}</dd>
          <template v-if="preview.mirrors.length">
            <dt>镜像</dt>
            <dd>{{ preview.mirrors.join('、') }}</dd>
          </template>
        </dl>
        <ElAlert type="warning" title="向发布者核对指纹" :closable="false" show-icon />
        <ElButton type="primary" :loading="registryBusy" @click="addRegistry">信任此工坊源</ElButton>
      </section>
    </ElDialog>
  </main>
</template>

<style scoped>
.workshop {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--el-text-color-primary);
  background: var(--el-bg-color-page);
}
.workshop-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 16px max(20px, calc((100% - 1280px) / 2));
  border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
}
.heading-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.heading-title .el-icon {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: 18px;
}
.heading-title h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.heading-tools {
  display: flex;
  gap: 8px;
  align-items: center;
}
.heading-tools :deep(.el-button) {
  margin: 0;
}
.registry-select {
  width: 200px;
}
.workshop-body {
  flex: 1;
  padding: clamp(14px, 2.4vw, 32px) clamp(14px, 2vw, 20px) 80px;
}
.workshop-content {
  display: grid;
  gap: 16px;
  max-width: 1280px;
  margin-inline: auto;
}
.workshop-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}
.workshop-search {
  flex: 1 1 320px;
  max-width: 480px;
}
.kind-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  background: var(--el-fill-color);
}
.kind-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.kind-tab:hover {
  color: var(--el-text-color-primary);
}
.kind-tab.active {
  background: var(--el-bg-color);
  color: var(--el-color-primary);
  font-weight: 600;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
}
.count {
  min-width: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: var(--el-fill-color-dark);
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  text-align: center;
}
.kind-tab.active .count {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.workshop-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.workshop-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-bg-color);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease,
    border-color 0.15s ease;
}
.workshop-card:hover,
.workshop-card:focus-visible {
  transform: translateY(-2px);
  border-color: var(--el-border-color);
  box-shadow: 0 8px 24px rgb(15 23 42 / 0.08);
}
.workshop-card:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.workshop-card.active {
  border-color: var(--el-color-primary);
}
.card-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px 16px;
}
.card-badges {
  display: flex;
  gap: 6px;
  align-items: center;
}
.kind-badge,
.official-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 20px;
}
.kind-badge {
  background: var(--el-fill-color);
  color: var(--el-text-color-regular);
}
.kind-badge.environment {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success-dark-2);
}
.official-badge {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.card-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
}
.card-summary {
  display: -webkit-box;
  overflow: hidden;
  color: var(--el-text-color-regular);
  font-size: 13px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.card-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding-top: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.card-version {
  font-family: var(--el-font-family-mono, ui-monospace, monospace);
}
.card-skeleton {
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-bg-color);
}
.skeleton-cover {
  aspect-ratio: 16 / 7;
  background: var(--el-fill-color);
}
.skeleton-lines {
  display: grid;
  gap: 8px;
  padding: 16px;
}
.skeleton-lines span {
  height: 12px;
  border-radius: 6px;
  background: var(--el-fill-color);
}
.skeleton-lines span:last-child {
  width: 60%;
}

.detail {
  display: grid;
  gap: 20px;
}
.detail-heading {
  display: grid;
  gap: 8px;
}
.detail-heading h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.detail-heading p {
  margin: 0;
  color: var(--el-text-color-regular);
  line-height: 1.6;
}
.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.install-box {
  display: grid;
  gap: 10px;
  padding: 14px;
  border-radius: 12px;
  background: var(--el-fill-color-light);
}
.install-row {
  display: flex;
  gap: 8px;
}
.version-select {
  flex: 1;
}
.install-button {
  min-width: 120px;
  margin: 0;
}
.field-error {
  margin: 0;
  color: var(--el-color-danger);
  font-size: 12px;
}
.notes {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
}
.notes li {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--el-color-warning-dark-2);
}
.notes li.danger {
  color: var(--el-color-danger);
}
.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
  gap: 1px;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-border-color-lighter);
}
.facts div {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  background: var(--el-bg-color);
}
.facts dt {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.facts dd {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
}
.detail-section {
  display: grid;
  gap: 10px;
}
.detail-section h3 {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  font-weight: 600;
}
.dependencies {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.dependencies li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
  font-size: 13px;
}
.dependencies code {
  overflow-wrap: anywhere;
}
.dependencies span {
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}
.source-list {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 8px 16px;
  margin: 0;
  font-size: 13px;
}
.source-list dt {
  color: var(--el-text-color-secondary);
}
.source-list dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.source-list a {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--el-color-primary);
  text-decoration: none;
}
.source-list a:hover {
  text-decoration: underline;
}
.registry-list {
  display: grid;
  gap: 8px;
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}
.registry-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.registry-list span {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.registry-list small,
.registry-list code {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  overflow-wrap: anywhere;
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
@media (max-width: 720px) {
  .workshop-heading {
    padding: 12px 16px;
  }
  .heading-title h1 {
    font-size: 19px;
  }
  .workshop-search {
    max-width: none;
  }
  .kind-tabs {
    width: 100%;
  }
  .kind-tab {
    flex: 1;
    justify-content: center;
  }
  .workshop-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
}
</style>

<style>
.workshop-drawer .el-drawer__body {
  padding: 20px;
}
.workshop-drawer.btt {
  border-radius: 16px 16px 0 0;
}
</style>
