/** The desktop must not remain open forever if an authority or static server hangs. */
export async function stopForQuit(tasks, { timeoutMs = 12000, forceStop } = {}) {
  let timeout
  try {
    const finished = await Promise.race([
      Promise.allSettled(tasks.map(task => Promise.resolve().then(task))).then(() => true),
      new Promise(resolve => {
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
