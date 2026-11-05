import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { LocalServerConfiguration, LocalServerRequest, LocalServerSnapshot } from '@/types/localServer'

export const useLocalServerStore = defineStore('localServer', () => {
  const snapshot = ref<LocalServerSnapshot>({ host: { status: 'idle' }, phase: 'idle', configured: false })
  const configuration = ref<LocalServerConfiguration>({
    name: '我的服务器',
    scope: 'lan',
    port: 8102,
    content: 'official',
  })
  const error = ref('')
  const pending = ref(false)
  let sequence = 0
  const available = !!window.arcadiaDesktop?.localServer
  const running = computed(() => snapshot.value.host.status === 'running')
  const busy = computed(() => pending.value || ['preparing', 'starting', 'draining'].includes(snapshot.value.phase))
  async function refresh() {
    if (!available) return
    const generation = ++sequence
    const result = await window.arcadiaDesktop!.localServer!({ action: 'status' })
    if (generation === sequence) snapshot.value = result
  }
  async function execute(input: LocalServerRequest) {
    if (!available) throw new Error('请在桌面客户端启动本机服务器')
    const force = input.action === 'stop' && input.force
    if (pending.value && !force) return
    pending.value = true
    error.value = ''
    snapshot.value = {
      ...snapshot.value,
      phase:
        input.action === 'start'
          ? 'preparing'
          : ['recover', 'start-project'].includes(input.action)
            ? 'starting'
            : 'draining',
    }
    try {
      const result = await window.arcadiaDesktop!.localServer!(input)
      ++sequence
      snapshot.value = result
      if (result.error) throw new Error(result.error.message)
      return result
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '服务器操作失败'
      throw cause
    } finally {
      pending.value = false
    }
  }
  return { available, configuration, snapshot, running, busy, error, refresh, execute }
})
