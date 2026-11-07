<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useLocalServerStore } from '@/stores/localServer'
const local = useLocalServerStore()
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false
async function refresh() {
  try {
    await local.refresh()
  } catch {
    /* Detailed errors and retry live on the server page. */
  } finally {
    if (!disposed) timer = setTimeout(refresh, 2500)
  }
}
onMounted(() => {
  if (local.available) void refresh()
})
onBeforeUnmount(() => {
  disposed = true
  clearTimeout(timer)
})
</script>
<template>
  <aside v-if="local.available && (local.running || local.busy)" class="local-server-strip" aria-label="本机服务器状态">
    <span>{{ local.busy ? '本机服务器正在处理操作' : '本机服务器运行中' }}</span>
    <RouterLink to="/servers">查看与管理</RouterLink>
  </aside>
</template>
<style scoped>
.local-server-strip {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  padding: 8px 16px;
  background: #edf3ff;
  color: #203047;
  font-size: 13px;
}
a {
  color: #245fc2;
  text-decoration: underline;
}
</style>
