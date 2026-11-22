/** Retry background cache passes after the workers have finished the other assets. */
export async function withPreloadBackoff(signal: AbortSignal, run: () => Promise<number>) {
  if (signal.aborted) return 0
  let failed = await run()
  for (const delay of [1000, 2000, 4000]) {
    if (!failed || signal.aborted) break
    await new Promise<void>(resolve => {
      const timer = setTimeout(finish, delay)
      function finish() {
        clearTimeout(timer)
        signal.removeEventListener('abort', finish)
        resolve()
      }
      signal.addEventListener('abort', finish, { once: true })
    })
    if (signal.aborted) break
    failed = await run()
  }
  return failed
}
