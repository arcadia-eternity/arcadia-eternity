import type { createSingleProcessApp } from '@arcadia-eternity/server'

/** Private parent/child channel, deliberately absent from HTTP and Socket.IO. */
export function attachDesktopContentControl(
  registry: ReturnType<typeof createSingleProcessApp>['environments'],
  builtinId: string,
): () => void {
  let pending = Promise.resolve()
  let closed = false
  const onMessage = (message: unknown) => {
    if (!message || typeof message !== 'object') return
    const input = message as Record<string, unknown>
    if (input.type !== 'arcadia.desktop.content' || typeof input.id !== 'string' || input.id.length > 80) return
    const id = input.id
    pending = pending
      .then(async () => {
        if (closed) return
        try {
          let value: unknown
          if (input.action === 'describe') value = registry.descriptor()
          else if (input.action === 'prepare') {
            if (input.builtinOnly === true) value = registry.descriptor(builtinId)
            else {
              if (typeof input.directory !== 'string' || input.directory.length > 4096)
                throw new Error('INVALID_DIRECTORY')
              value = await registry.prepareNpm(input.directory)
            }
          } else if (input.action === 'select') {
            if (typeof input.environmentId !== 'string') throw new Error('INVALID_ENVIRONMENT')
            value = registry.selectDefault(input.environmentId)
          } else if (input.action === 'retire') {
            if (typeof input.environmentId !== 'string' || input.environmentId === builtinId)
              throw new Error('INVALID_ENVIRONMENT')
            await registry.retire(input.environmentId)
            value = null
          } else throw new Error('INVALID_ACTION')
          if (!closed && process.connected)
            process.send?.({ type: 'arcadia.desktop.content.result', id, ok: true, value })
        } catch {
          if (!closed && process.connected) process.send?.({ type: 'arcadia.desktop.content.result', id, ok: false })
        }
      })
      .catch(() => {})
  }
  process.on('message', onMessage)
  return () => {
    closed = true
    process.off('message', onMessage)
  }
}
