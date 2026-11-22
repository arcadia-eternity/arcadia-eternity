import { computed, shallowReactive, shallowRef } from 'vue'

type BatchState = 'active' | 'finished' | 'cancelled'
export type MediaPreloadBatch = {
  id: number
  label: string
  state: BatchState
  total: number
  completed: number
  failed: number
  cached: number
  startedAt: number
  lastProgressAt: number
  loading: Map<number, string>
}

let sequence = 0
const active = shallowReactive(new Map<number, MediaPreloadBatch>())
const recent = shallowRef<MediaPreloadBatch[]>([])
export const isMediaPreloading = computed(() => active.size > 0)
export const mediaPreloadBatches = computed(() => [...active.values(), ...recent.value])

export function startMediaPreload(
  label: string,
  total: number,
  signal: AbortSignal,
  progress?: (completed: number, total: number, failed: number) => void,
  onFailure?: (index: number) => void,
) {
  const startedAt = performance.now()
  const batch = shallowReactive<MediaPreloadBatch>({
    id: ++sequence,
    label,
    state: 'active',
    total,
    completed: 0,
    failed: 0,
    cached: 0,
    startedAt,
    lastProgressAt: startedAt,
    loading: shallowReactive(new Map()),
  })
  active.set(batch.id, batch)
  function finish() {
    signal.removeEventListener('abort', finish)
    if (active.delete(batch.id)) {
      batch.state = signal.aborted ? 'cancelled' : 'finished'
      batch.loading.clear()
      recent.value = [batch, ...recent.value.slice(0, 2)]
    }
  }
  signal.addEventListener('abort', finish, { once: true })
  if (signal.aborted) finish()
  return {
    finish,
    get failed() {
      return batch.failed
    },
    async run(index: number, name: string, load: () => Promise<unknown>) {
      if (signal.aborted) return
      batch.loading.set(index, name)
      try {
        if ((await load()) === 'cached' && !signal.aborted) batch.cached++
      } catch {
        if (!signal.aborted) {
          batch.failed++
          onFailure?.(index)
        }
      }
      if (signal.aborted) return
      batch.loading.delete(index)
      batch.completed++
      batch.lastProgressAt = performance.now()
      progress?.(batch.completed, total, batch.failed)
    },
  }
}

// Measure completed items per unit of wall time, including concurrent reads and cache writes.
export function estimatePreloadSeconds(batch: MediaPreloadBatch, now: number): number | undefined {
  const observed = batch.lastProgressAt - batch.startedAt
  if (batch.state !== 'active' || batch.completed < 2 || observed < 1000 || batch.completed >= batch.total) return
  const average = observed / batch.completed
  const sinceProgress = Math.max(0, now - batch.lastProgressAt)
  const remaining = average * (batch.total - batch.completed) - sinceProgress
  if (remaining <= 0 || sinceProgress > Math.max(5000, 3 * average)) return
  return Math.ceil(remaining / 1000)
}
