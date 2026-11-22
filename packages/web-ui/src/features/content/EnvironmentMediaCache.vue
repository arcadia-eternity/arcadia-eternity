<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { ElButton, ElMessageBox } from 'element-plus'
import { getBackendOrigin } from '@/bootstrap/deployment'
import { acquireLocalContent } from '@/services/localContent'
import { listServerEnvironments, prepareServerEnvironment } from '@/services/serverEnvironment'
import {
  clearMediaCache,
  environmentAssets,
  mediaEnvironment,
  preloadMedia,
  declaredMediaAssets,
} from '@/services/environmentMedia'
import { usePrivateRoomStore } from '@/stores/privateRoom'
import { useBattleClientStore } from '@/stores/battleClient'

const props = defineProps<{ selection: { id: string; location: 'web' | 'local' | 'server' | 'room'; key: string } }>()
const busy = ref(false)
const status = ref('')
let operation: AbortController | undefined
onBeforeUnmount(() => operation?.abort())

async function capture(signal: AbortSignal) {
  const { id, location, key } = props.selection
  const hosted = location === 'local' && key.startsWith('host/')
  if (location === 'web' || (location === 'local' && !hosted)) {
    const captured = await acquireLocalContent(id)
    if (!captured) throw new Error('当前环境内容不可用')
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
    : (await listServerEnvironments(server, fetch, signal)).find(row => (row.environmentId ?? row.id) === id)
  if (!descriptor || (room && descriptor.id !== key)) throw new Error('此环境尚未发布或已变更')
  return prepareServerEnvironment(server, descriptor, fetch, signal)
}
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
      !(await ElMessageBox.confirm('清除此环境已保存的资源？', '清理缓存').then(
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
    if (clear) {
      await clearMediaCache(env.scope)
      status.value = '缓存已清理'
    } else {
      await preloadMedia(
        [...environmentAssets(result.content), ...declaredMediaAssets(env.resources)],
        env,
        controller.signal,
        (done, total, failed) => {
          status.value = total
            ? `已保存 ${done - failed}/${total}${failed ? `，失败 ${failed}` : ''}`
            : '没有需要缓存的资源'
        },
      )
    }
  } catch (error) {
    if (!controller.signal.aborted) status.value = error instanceof Error ? error.message : '资源缓存失败'
  } finally {
    await release?.()
    busy.value = false
  }
}
</script>
<template>
  <div class="flex flex-wrap items-center gap-2">
    <span role="status">{{ status }}</span>
    <ElButton :disabled="busy" @click="run()">缓存环境资源</ElButton>
    <ElButton v-if="busy" @click="cancel">取消</ElButton>
    <ElButton v-else plain @click="run(true)">清理缓存</ElButton>
  </div>
</template>
