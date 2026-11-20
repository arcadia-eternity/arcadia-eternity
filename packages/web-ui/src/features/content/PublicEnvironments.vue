<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElButton, ElTag, ElSkeleton } from 'element-plus'
import { getBackendOrigin } from '@/bootstrap/deployment'
import { listServerEnvironments } from '@/services/serverEnvironment'
import type { ServerEnvironmentDescriptor } from '@arcadia-eternity/protocol'
import { readPreparedWebCatalog } from '@/services/preparedWebEnvironment'
import type { EnvironmentLocation } from './environmentGroups'
const props = defineProps<{ bundled?: boolean; selection?: string | null }>()
const emit = defineEmits<{ catalog: [rows: EnvironmentLocation[]] }>()
const heading = computed(() => (props.bundled ? '网页内置环境' : '公开环境'))
type EnvironmentRow = Pick<
  ServerEnvironmentDescriptor,
  'id' | 'environmentId' | 'environmentName' | 'isDefault' | 'executionPolicy'
> & {
  packages: { name: string; version: string }[]
}
const environments = ref<EnvironmentRow[]>([])
const selectedId = ref('')
const logicalId = (row: EnvironmentRow) => row.environmentId ?? row.id
const sourceKey = (row: EnvironmentRow) => (props.bundled ? row.id : 'server/' + logicalId(row))
const selected = computed(() =>
  props.selection
    ? environments.value.find(item => sourceKey(item) === props.selection)
    : (environments.value.find(item => item.id === selectedId.value) ??
      environments.value.find(item => item.isDefault) ??
      environments.value[0]),
)
const loading = ref(false)
const initialized = ref(false)
const error = ref('')
const name = (environment: EnvironmentRow) =>
  environment.environmentName || (environment.isDefault ? '默认环境' : `环境 ${environment.id.slice(0, 8)}`)
watch(
  environments,
  rows =>
    emit(
      'catalog',
      rows.map(row => ({
        id: logicalId(row),
        name: name(row),
        key: sourceKey(row),
        source: props.bundled ? '网页内置' : '服务器',
      })),
    ),
  { immediate: true },
)
let controller: AbortController | undefined
async function refresh() {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true
  error.value = ''
  try {
    let result: EnvironmentRow[]
    if (props.bundled) {
      const catalog = await readPreparedWebCatalog()
      result = (catalog.builtins ?? []).map(doc => ({
        id: doc.id,
        environmentName: doc.name,
        packages: doc.packages,
        isDefault: doc.id === catalog.defaultEnvironment,
      }))
    } else result = await listServerEnvironments(getBackendOrigin(), fetch, request.signal)
    if (!request.signal.aborted) environments.value = result
  } catch (cause) {
    if (!request.signal.aborted) error.value = cause instanceof Error ? cause.message : '无法读取公开环境'
  } finally {
    if (!request.signal.aborted) {
      loading.value = false
      initialized.value = true
    }
  }
}
onMounted(refresh)
onBeforeUnmount(() => controller?.abort())
</script>
<template>
  <section v-if="selection !== null" :aria-label="heading" class="public-environments">
    <header>
      <h2>{{ heading }}</h2>
      <ElButton :loading="loading" @click="refresh">刷新</ElButton>
    </header>
    <ElSkeleton v-if="!initialized" :rows="6" animated :aria-label="'正在加载' + heading" />
    <p v-else-if="error" role="alert">{{ error }}</p>
    <p v-else-if="!loading && !environments.length">{{ bundled ? '暂无网页内置环境。' : '服务器暂无公开环境。' }}</p>
    <div v-else class="environment-columns" :class="{ 'detail-only': selection !== undefined }">
      <nav v-if="selection === undefined" :aria-label="'选择' + heading">
        <ElButton
          v-for="environment in environments"
          :key="environment.id"
          :aria-current="selected?.id === environment.id ? 'true' : undefined"
          @click="selectedId = environment.id"
          >{{ name(environment) }}</ElButton
        >
      </nav>
      <p v-if="selection && !selected" role="status">此来源的环境已不可用。</p>
      <article v-if="selected" :aria-label="heading + '详情'">
        <header>
          <h3>{{ name(selected) }}</h3>
          <ElTag>只读</ElTag>
        </header>
        <p v-if="!bundled">{{ selected.executionPolicy === 'peer' ? '由玩家托管' : '服务器执行' }}</p>
        <h4>包含的内容包</h4>
        <ul>
          <li v-for="pkg in selected.packages" :key="pkg.name">
            <strong>{{ pkg.name }}</strong
            ><span>{{ pkg.version }}</span>
          </li>
        </ul>
        <details>
          <summary>环境标识</summary>
          <code>{{ selected.id }}</code>
        </details>
      </article>
    </div>
  </section>
</template>
<style scoped>
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.environment-columns {
  display: grid;
  grid-template-columns: minmax(160px, 220px) minmax(0, 1fr);
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
}
.environment-columns.detail-only {
  grid-template-columns: minmax(0, 1fr);
}
nav,
article {
  padding: 16px;
  min-width: 0;
}
nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-right: 1px solid var(--el-border-color-light);
}
nav :deep(.el-button) {
  margin: 0;
}
nav button[aria-current='true'] {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary);
}
li {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  margin: 12px 0;
  overflow-wrap: anywhere;
}
code {
  overflow-wrap: anywhere;
}
details {
  margin-top: 16px;
}
summary {
  cursor: pointer;
}
@media (max-width: 600px) {
  .environment-columns {
    grid-template-columns: minmax(0, 1fr);
  }
  nav {
    border-right: 0;
    border-bottom: 1px solid var(--el-border-color-light);
  }
}
</style>
