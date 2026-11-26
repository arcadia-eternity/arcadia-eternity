/** Media reads of a lower priority wait between items while a higher-priority batch is loading. */
export type MediaPriority = 'critical' | 'deferred' | 'background'

const rank: Record<MediaPriority, number> = { critical: 0, deferred: 1, background: 2 }
const active: Record<MediaPriority, number> = { critical: 0, deferred: 0, background: 0 }
let waiters = new Set<() => void>()

export const fetchPriority = (priority: MediaPriority): RequestPriority => (priority === 'critical' ? 'high' : 'low')

const outranked = (priority: MediaPriority) =>
  (Object.keys(active) as MediaPriority[]).some(level => rank[level] < rank[priority] && active[level] > 0)

export function beginMediaPriority(priority: MediaPriority) {
  active[priority]++
  let ended = false
  return () => {
    if (ended) return
    ended = true
    active[priority]--
    const pending = waiters
    waiters = new Set()
    for (const wake of pending) wake()
  }
}

export async function waitForMediaPriority(priority: MediaPriority, signal?: AbortSignal) {
  while (outranked(priority) && !signal?.aborted) {
    await new Promise<void>(resolve => {
      const wake = () => {
        waiters.delete(wake)
        signal?.removeEventListener('abort', wake)
        resolve()
      }
      waiters.add(wake)
      signal?.addEventListener('abort', wake, { once: true })
    })
  }
}
