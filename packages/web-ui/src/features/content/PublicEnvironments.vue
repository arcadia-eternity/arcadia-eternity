<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import EnvironmentLayout from './EnvironmentLayout.vue'
import EnvironmentDirectory from './EnvironmentDirectory.vue'
import EnvironmentPanel from './EnvironmentPanel.vue'
import EnvironmentDetailHeading from './EnvironmentDetailHeading.vue'
import EnvironmentPackageRow from './EnvironmentPackageRow.vue'
import EnvironmentPackagePreview from './EnvironmentPackagePreview.vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElButton, ElTag, ElSkeleton, ElAlert, ElEmpty } from 'element-plus'
import { getBackendOrigin } from '@/bootstrap/deployment'
import { listServerEnvironments, readServerEnvironmentContent } from '@/services/serverEnvironment'
import type { ServerEnvironmentContent, ServerEnvironmentDescriptor } from '@arcadia-eternity/protocol'
import { readBuiltinWebEnvironment, readPreparedWebCatalog } from '@/services/preparedWebEnvironment'
import type { EnvironmentLocation } from './environmentGroups'
import { indexPackagePreviews, packagePreview } from './environmentPackagePreview'
const props = defineProps<{ bundled?: boolean; selection?: string | null }>()
const emit = defineEmits<{ catalog: [rows: EnvironmentLocation[]] }>()
const heading = computed(() => (props.bundled ? '网页内置环境' : '公开环境'))
type EnvironmentRow = Pick<
  ServerEnvironmentDescriptor,
  'id' | 'environmentVersion' | 'environmentId' | 'environmentName' | 'isDefault' | 'executionPolicy'
> & {
  packages: { name: string; version: string; namespace?: string; projectId?: string }[]
}
const environments = ref<EnvironmentRow[]>([])
const selectedId = ref('')
const logicalId = (row: EnvironmentRow) => row.environmentId ?? row.id
const sourceKey = (row: EnvironmentRow) => (props.bundled ? row.id : 'publication/' + row.id)
const selected = computed(() => {
  if (props.selection === null) return undefined
  if (props.selection) return environments.value.find(item => sourceKey(item) === props.selection)
  return (
    environments.value.find(item => sourceKey(item) === selectedId.value) ??
    environments.value.find(item => item.isDefault) ??
    environments.value[0]
  )
})
const loading = ref(false)
const initialized = ref(false)
const error = ref('')
const content = shallowRef<ServerEnvironmentContent>()
const previewLoading = ref(false)
const previewError = ref(false)
const previews = computed(() => indexPackagePreviews(content.value))
const packages = computed(
  () => selected.value?.packages.map(pkg => ({ ...pkg, preview: packagePreview(previews.value, pkg) })) ?? [],
)
watch(selected, async (environment, _, onCleanup) => {
  content.value = undefined
  previewError.value = false
  previewLoading.value = !!environment?.packages.length
  if (!environment?.packages.length) return
  const request = new AbortController()
  const { signal } = request
  onCleanup(() => request.abort())
  try {
    const catalog = props.bundled
      ? (await readBuiltinWebEnvironment(environment.id)).content
      : await readServerEnvironmentContent(getBackendOrigin(), environment.id, fetch, signal)
    if (!signal.aborted) content.value = catalog
  } catch {
    if (!signal.aborted) previewError.value = true
  } finally {
    if (!signal.aborted) previewLoading.value = false
  }
})
const name = (environment: EnvironmentRow) =>
  environment.environmentName || (environment.isDefault ? '默认环境' : `环境 ${environment.id.slice(0, 8)}`)
const entries = computed(() =>
  environments.value.map(row => ({
    id: logicalId(row),
    environmentVersion: row.environmentVersion,
    name: name(row),
    key: sourceKey(row),
    source: props.bundled ? '网页内置' : '服务器',
  })),
)
watch(entries, rows => emit('catalog', rows), { immediate: true })
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
        environmentVersion: doc.environmentVersion,
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
    <EnvironmentLayout>
      <template v-if="selection === undefined" #directory>
        <EnvironmentDirectory
          :entries="entries"
          :selected="selected && sourceKey(selected)"
          :label="'选择' + heading"
          @select="selectedId = $event"
        />
      </template>
      <EnvironmentPanel :heading="heading">
        <template #tools>
          <ElButton :loading="loading" :icon="Refresh" @click="refresh">刷新</ElButton>
        </template>
        <ElSkeleton v-if="!initialized" :rows="6" animated :aria-label="'正在加载' + heading" />
        <ElAlert v-else-if="error" type="error" role="alert" :title="error" show-icon :closable="false" />
        <ElEmpty
          v-else-if="!environments.length"
          :image-size="64"
          :description="bundled ? '暂无网页内置环境。' : '服务器暂无公开环境。'"
        />
        <article v-else-if="selected" :aria-label="heading + '详情'">
          <EnvironmentDetailHeading :name="name(selected)" :environment-version="selected.environmentVersion" readonly>
            <template #status>
              <ElTag v-if="selected.isDefault" size="small">默认</ElTag>
              <ElTag v-if="!bundled" size="small" type="info">{{
                selected.executionPolicy === 'peer' ? '由玩家托管' : '服务器执行'
              }}</ElTag>
            </template>
          </EnvironmentDetailHeading>
          <h4>环境内的内容包</h4>
          <p v-if="previewLoading" class="preview-status" role="status">正在读取内容预览…</p>
          <p v-else-if="previewError" class="preview-status" role="status">无法读取内容预览</p>
          <EnvironmentPackageRow
            v-for="pkg in packages"
            :key="JSON.stringify([selected.id, pkg.name, pkg.version])"
            :name="pkg.name"
            :version="pkg.version"
          >
            <template v-if="pkg.preview" #default>
              <EnvironmentPackagePreview :preview="pkg.preview" />
            </template>
          </EnvironmentPackageRow>
          <ElEmpty v-if="!packages.length" :image-size="48" description="暂无内容包" />
          <details class="environment-identifier">
            <summary>环境标识</summary>
            <code>{{ selected.id }}</code>
          </details>
        </article>
        <ElEmpty v-else role="status" :image-size="64" description="此来源的环境已不可用。" />
      </EnvironmentPanel>
    </EnvironmentLayout>
  </section>
</template>
<style scoped>
h4 {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 8px;
}
.preview-status {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  margin: 8px 0;
}
.environment-identifier {
  border-top: 1px solid var(--el-border-color-lighter);
  padding-top: 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
summary {
  cursor: pointer;
}
code {
  display: block;
  margin-top: 8px;
  overflow-wrap: anywhere;
}
</style>
