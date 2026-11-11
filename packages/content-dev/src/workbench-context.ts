import { readFile, stat } from 'node:fs/promises'
import { errorCode, isRecord } from './types.ts'

export interface WorkbenchContext {
  connected: boolean
  reason?: string
  protocol?: string
  root?: string
  updatedAt?: number
  [key: string]: unknown
}

/** Ephemeral desktop state is context, never an edit authorization or a disk revision. */
export async function readWorkbenchContext(
  file: string | undefined,
  root: string,
  now = Date.now(),
): Promise<WorkbenchContext> {
  if (!file) return { connected: false, reason: 'not-configured' }
  try {
    if ((await stat(file)).size > 4 * 1024 * 1024) throw new Error('Workbench context exceeds 4 MiB')
    const context: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (!isRecord(context)) return { connected: false, reason: 'project-mismatch' }
    if (context.protocol !== 'arcadia-workbench-context/v1' || context.root !== root)
      return { connected: false, reason: 'project-mismatch' }
    if (
      typeof context.updatedAt !== 'number' ||
      !Number.isFinite(context.updatedAt) ||
      now - context.updatedAt > 90000 ||
      context.updatedAt > now + 5000
    )
      return { connected: false, reason: 'expired' }
    return { connected: true, ...context }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { connected: false, reason: 'workbench-closed' }
    throw error
  }
}
