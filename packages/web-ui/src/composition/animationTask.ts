/** Bound an async operation independently of its RPC, and settle on cancellation. */
export function waitForAnimationOperation<T>(operation: Promise<T>, signal: AbortSignal, timeout: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      callback()
    }
    const cancel = () => finish(() => reject(new DOMException('动画任务已取消', 'AbortError')))
    const timer = setTimeout(() => finish(() => reject(new Error('动画任务超时'))), timeout)
    signal.addEventListener('abort', cancel, { once: true })
    operation.then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
    )
    if (signal.aborted) cancel()
  })
}
