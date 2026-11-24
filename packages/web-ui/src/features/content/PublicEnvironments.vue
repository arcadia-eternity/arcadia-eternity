<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import EnvironmentLayout from './EnvironmentLayout.vue'
import EnvironmentDirectory from './EnvironmentDirectory.vue'
import EnvironmentPanel from './EnvironmentPanel.vue'
import EnvironmentDetailHeading from './EnvironmentDetailHeading.vue'
import EnvironmentPackageRow from './EnvironmentPackageRow.vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElButton, ElTag, ElSkeleton, ElAlert, ElEmpty } from 'element-plus'
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
  'id' | 'environmentVersion' | 'environmentId' | 'environmentName' | 'isDefault' | 'executionPolicy'
> & {
  packages: { name: string; version: string }[]
}
const environments = ref<EnvironmentRow[]>([])
const selectedId = ref('')
const logicalId = (row: EnvironmentRow) => row.environmentId ?? row.id
const sourceKey = (row: EnvironmentRow) => (props.bundled ? row.id : 'publication/' + row.id)
const selected = computed(() =>
  props.selection
    ? environments.value.find(item => sourceKey(item) === props.selection)
    : (environments.value.find(item => sourceKey(item) === selectedId.value) ??
      environments.value.find(item => item.isDefault) ??
      environments.value[0]),
)
const loading = ref(false)
const initialized = ref(false)
const error = ref('')
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
          <EnvironmentDetailHeading :name="name(selected)" readonly>
            <template #status>
              <ElTag v-if="selected.isDefault" size="small">默认</ElTag>
              <ElTag v-if="!bundled" size="small" type="info">{{
                selected.executionPolicy === 'peer' ? '由玩家托管' : '服务器执行'
              }}</ElTag>
            </template>
          </EnvironmentDetailHeading>
          <h4>环境内的内容包</h4>
          <EnvironmentPackageRow
            v-for="pkg in selected.packages"
            :key="pkg.name"
            :name="pkg.name"
            :version="pkg.version"
          />
          <ElEmpty v-if="!selected.packages.length" :image-size="48" description="暂无内容包" />
          <details>
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
details {
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
