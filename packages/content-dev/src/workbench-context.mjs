import { readFile, stat } from 'node:fs/promises'

/** Ephemeral desktop state is context, never an edit authorization or a disk revision. */
export async function readWorkbenchContext(file, root, now = Date.now()) {
  if (!file) return { connected: false, reason: 'not-configured' }
  try {
    if ((await stat(file)).size > 4 * 1024 * 1024) throw new Error('Workbench context exceeds 4 MiB')
    const context = JSON.parse(await readFile(file, 'utf8'))
    if (context.protocol !== 'arcadia-workbench-context/v1' || context.root !== root)
      return { connected: false, reason: 'project-mismatch' }
    if (!Number.isFinite(context.updatedAt) || now - context.updatedAt > 90000 || context.updatedAt > now + 5000)
      return { connected: false, reason: 'expired' }
    return { connected: true, ...context }
  } catch (error) {
    if (error.code === 'ENOENT') return { connected: false, reason: 'workbench-closed' }
    throw error
  }
}
