<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElButton, ElMessageBox } from 'element-plus'
import { getBackendOrigin } from '@/bootstrap/deployment'
import { acquireLocalContent } from '@/services/localContent'
import { listServerEnvironments, prepareServerEnvironment } from '@/services/serverEnvironment'
import { clearMediaCache, mediaCacheUsage, mediaEnvironment } from '@/services/mediaLoader'
import { isMediaPreloading } from '@/services/mediaPreloadProgress'
import { allEnvironmentAssets, preloadMedia } from '@/services/environmentMedia'
import { usePrivateRoomStore } from '@/stores/privateRoom'
import { useBattleClientStore } from '@/stores/battleClient'

const props = defineProps<{
  selection: { id: string; environmentVersion?: string; location: 'web' | 'local' | 'server' | 'room'; key: string }
}>()
const busy = ref(false)
const status = ref('')
const usage = ref<{ files: number; bytes: number }>()
const usageUnavailable = ref(false)
const selectedScope = ref<string>()
let operation: AbortController | undefined
let usageRequest = 0
onBeforeUnmount(() => operation?.abort())

async function capture(signal: AbortSignal) {
  const { id, location, key, environmentVersion } = props.selection
  const hosted = location === 'local' && key.startsWith('host/')
  if (location === 'web' || (location === 'local' && !hosted)) {
    const captured = await acquireLocalContent(id)
    if (!captured) throw new Error('当前环境内容不可用')
    if (environmentVersion && captured.environmentVersion !== environmentVersion) {
      await captured.release()
      throw new Error('本地环境版本已变更')
    }
    return captured
  }
  const room = location === 'room' ? usePrivateRoomStore() : undefined
  if (room?.currentRoom?.personalEnvironment) {
    if (!room.personalEnvironment || room.personalEnvironment.reference.descriptor.id !== key)
      throw new Error('请先导入房间环境')
    return { content: room.personalEnvironment.content }
  }
  let server = room ? useBattleClientStore().serverUrl : getBackendOrigin()
  if (hosted) {
    const snapshot = await window.arcadiaDesktop?.localServer?.({ action: 'status' })
    if (snapshot?.host.status !== 'running') throw new Error('本机服务器未启动')
    server = snapshot.host.url
  }
  const descriptor = room
    ? room.currentRoom?.environment
    : (await listServerEnvironments(server, fetch, signal)).find(
        row =>
          (key.startsWith('publication/') ? key === 'publication/' + row.id : (row.environmentId ?? row.id) === id) &&
          (!environmentVersion || row.environmentVersion === environmentVersion),
      )
  if (!descriptor || (room && descriptor.id !== key)) throw new Error('此环境尚未发布或已变更')
  return prepareServerEnvironment(server, descriptor, fetch, signal)
}
async function refreshUsage(signal: AbortSignal) {
  const request = ++usageRequest
  try {
    if (!selectedScope.value) {
      const result = await capture(signal)
      try {
        signal.throwIfAborted()
        selectedScope.value = mediaEnvironment(result.content).scope
      } finally {
        if ('release' in result) await result.release()
      }
    }
    const current = await mediaCacheUsage(selectedScope.value)
    if (!signal.aborted && request === usageRequest) {
      usage.value = current
      usageUnavailable.value = false
    }
  } catch {
    if (!signal.aborted && request === usageRequest) usageUnavailable.value = true
  }
}
watch(
  () => props.selection.key,
  (_, __, onCleanup) => {
    const controller = new AbortController()
    const stop = watch(isMediaPreloading, active => {
      if (!active && selectedScope.value) void refreshUsage(controller.signal)
    })
    onCleanup(() => {
      controller.abort()
      stop()
    })
    selectedScope.value = undefined
    usage.value = undefined
    usageUnavailable.value = false
    void refreshUsage(controller.signal)
  },
  { immediate: true },
)
function cancel() {
  operation?.abort()
  status.value = '已取消'
}
async function run(clear = false) {
  if (busy.value) return
  busy.value = true
  const controller = new AbortController()
  operation = controller
  let release: (() => Promise<void>) | undefined
  try {
    if (
      clear &&
      !(await ElMessageBox.confirm('清除此环境已保存的资源？下次使用时会重新缓存。', '清理缓存').then(
        () => true,
        () => false,
      ))
    )
      return
    controller.signal.throwIfAborted()
    status.value = '正在读取环境…'
    const result = await capture(controller.signal)
    if ('release' in result) release = result.release
    controller.signal.throwIfAborted()
    const env = mediaEnvironment(result.content)
    selectedScope.value = env.scope
    if (clear) {
      await clearMediaCache(env.scope)
      status.value = '缓存已清理'
    } else {
      await preloadMedia(allEnvironmentAssets(result.content, env), env, controller.signal, {
        save(done, total, failed) {
          status.value = total
            ? `已保存 ${done - failed}/${total}${failed ? `，失败 ${failed}` : ''}`
            : '没有需要缓存的资源'
        },
      })
    }
  } catch (error) {
    if (!controller.signal.aborted) status.value = error instanceof Error ? error.message : '资源缓存失败'
  } finally {
    if (selectedScope.value && !controller.signal.aborted) await refreshUsage(controller.signal)
    await release?.()
    busy.value = false
  }
}
</script>
<template>
  <div class="flex flex-wrap items-center gap-2">
    <span v-if="usageUnavailable">缓存用量暂不可用</span>
    <span v-else-if="usage"
      >本环境已保存 {{ usage.files }} 个文件 ·
      {{ (usage.bytes / 1048576).toLocaleString(undefined, { maximumFractionDigits: 2 }) }} MiB</span
    >
    <span role="status">{{ status }}</span>
    <ElButton :disabled="busy" @click="run()">立即缓存全部资源</ElButton>
    <ElButton v-if="busy" @click="cancel">取消</ElButton>
    <ElButton v-else plain @click="run(true)">清理缓存</ElButton>
  </div>
</template>
