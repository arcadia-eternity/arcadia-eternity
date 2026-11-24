interface ShutdownOptions {
  timeoutMs?: number
  forceStop?: () => void
}

/** The desktop must not remain open forever if an authority or static server hangs. */
export async function stopForQuit(
  tasks: ReadonlyArray<() => unknown>,
  { timeoutMs = 12000, forceStop }: ShutdownOptions = {},
) {
  let timeout: NodeJS.Timeout | undefined
  try {
    const finished = await Promise.race([
      Promise.allSettled(tasks.map(task => Promise.resolve().then(task))).then(() => true),
      new Promise<boolean>(resolve => {
        timeout = setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
    if (!finished) {
      try {
        forceStop?.()
      } catch {
        /* Keep application shutdown bounded. */
      }
    }
  } finally {
    clearTimeout(timeout)
  }
}
