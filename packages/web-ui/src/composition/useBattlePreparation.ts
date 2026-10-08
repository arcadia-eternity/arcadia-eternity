import { computed, ref } from 'vue'

export type PreparationState = 'pending' | 'loading' | 'ready' | 'degraded' | 'error'
export interface PreparationTask {
  id: string
  label: string
  state: PreparationState
}
export interface PreparationJob {
  id: string
  label: string
  required?: boolean
  run: () => Promise<void>
}

export function withDeadline<T>(promise: Promise<T>, ms: number, message = '资源准备超时'): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export function useBattlePreparation() {
  const tasks = ref<PreparationTask[]>([])
  const error = ref<string | null>(null)
  const ready = ref(false)
  let generation = 0
  const progress = computed(() => {
    if (!tasks.value.length) return 0
    const completed = tasks.value.filter(t => t.state === 'ready' || t.state === 'degraded').length
    return Math.min(ready.value ? 100 : 99, Math.round((completed / tasks.value.length) * 100))
  })
  const degraded = computed(() => tasks.value.filter(t => t.state === 'degraded').map(t => t.label))

  async function prepare(jobs: PreparationJob[]) {
    const run = ++generation
    ready.value = false
    error.value = null
    tasks.value = jobs.map(({ id, label }) => ({ id, label, state: 'pending' }))
    for (const job of jobs) {
      if (run !== generation) return
      const task = tasks.value.find(t => t.id === job.id)!
      task.state = 'loading'
      try {
        const work = job.run()
        // Optional visuals may recover after the loading deadline. Update only
        // their resource status; never rerun preparation or the ready handshake.
        void work.then(
          () => {
            if (run === generation && task.state === 'degraded') task.state = 'ready'
          },
          () => {},
        )
        await withDeadline(work, 12000, `${job.label}超时`)
        if (run !== generation) return
        task.state = 'ready'
      } catch (cause) {
        if (run !== generation) return
        task.state = job.required ? 'error' : 'degraded'
        if (job.required) {
          error.value = cause instanceof Error ? cause.message : `${job.label}失败`
          return
        }
      }
    }
    if (run === generation) ready.value = true
  }
  function cancel() {
    generation++
  }
  return { tasks, error, ready, progress, degraded, prepare, cancel }
}
