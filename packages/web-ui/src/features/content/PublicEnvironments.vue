<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElButton, ElTag } from 'element-plus'
import { getBackendOrigin } from '@/bootstrap/deployment'
import { listServerEnvironments } from '@/services/serverEnvironment'
import type { ServerEnvironmentDescriptor } from '@arcadia-eternity/protocol'
const environments = ref<ServerEnvironmentDescriptor[]>([])
const selectedId = ref('')
const selected = computed(
  () =>
    environments.value.find(item => item.id === selectedId.value) ??
    environments.value.find(item => item.isDefault) ??
    environments.value[0],
)
const loading = ref(false)
const error = ref('')
const name = (environment: ServerEnvironmentDescriptor) =>
  environment.isDefault ? '默认环境' : `环境 ${environment.id.slice(0, 8)}`
let controller: AbortController | undefined
async function refresh() {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true
  error.value = ''
  try {
    const result = await listServerEnvironments(getBackendOrigin(), fetch, request.signal)
    if (!request.signal.aborted) environments.value = result
  } catch (cause) {
    if (!request.signal.aborted) error.value = cause instanceof Error ? cause.message : '无法读取公开环境'
  } finally {
    if (!request.signal.aborted) loading.value = false
  }
}
onMounted(refresh)
onBeforeUnmount(() => controller?.abort())
</script>
<template>
  <section aria-label="公开环境" class="public-environments">
    <header>
      <h2>公开环境</h2>
      <ElButton :loading="loading" @click="refresh">刷新</ElButton>
    </header>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-else-if="!loading && !environments.length">服务器暂无公开环境。</p>
    <div v-else class="environment-columns">
      <nav aria-label="选择公开环境">
        <ElButton
          v-for="environment in environments"
          :key="environment.id"
          :aria-current="selected?.id === environment.id ? 'true' : undefined"
          @click="selectedId = environment.id"
          >{{ name(environment) }}</ElButton
        >
      </nav>
      <article v-if="selected" aria-label="公开环境详情">
        <header>
          <h3>{{ name(selected) }}</h3>
          <ElTag>只读</ElTag>
        </header>
        <p>{{ selected.executionPolicy === 'peer' ? '由玩家托管' : '服务器执行' }}</p>
        <h4>包含的内容包</h4>
        <ul>
          <li v-for="pkg in selected.packages" :key="pkg.projectId">
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
  grid-template-columns: minmax(160px, 25%) minmax(0, 1fr);
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
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
