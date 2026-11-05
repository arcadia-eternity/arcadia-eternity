import { randomUUID } from 'node:crypto'
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

async function inspect(path, directory = false) {
  const info = await lstat(path).catch(error => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (info && (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())))
    throw new Error(`Unsafe pnpm workspace metadata: ${path}`)
  return info
}

/** pnpm 11 legacy deploy writes production-only settings into its source
 * workspace state, although it installs dependencies in the deployment tree.
 * The caller must hold the source dependency snapshot stable for this whole
 * action: concurrent installs or dependency edits are not supported.
 */
export async function withPreservedPnpmWorkspaceState(repository, action) {
  const directory = join(resolve(repository), 'node_modules')
  const path = join(directory, '.pnpm-workspace-state-v1.json')
  await inspect(directory, true)
  const original = await inspect(path)
  const bytes = original ? await readFile(path) : undefined
  let result,
    actionError,
    actionFailed = false
  try {
    result = await action()
  } catch (error) {
    actionFailed = true
    actionError = error
  }

  try {
    await inspect(directory, true)
    const current = await inspect(path)
    if (!original) {
      if (current) await unlink(path)
    } else if (!current || !(await readFile(path)).equals(bytes)) {
      const temporary = join(directory, `.pnpm-workspace-state-restore-${randomUUID()}.tmp`)
      let restoreError
      try {
        await writeFile(temporary, bytes, { flag: 'wx', mode: original.mode & 0o777 })
        await inspect(path)
        await rename(temporary, path)
      } catch (error) {
        restoreError = error
      }
      try {
        await unlink(temporary).catch(error => {
          if (error.code !== 'ENOENT') throw error
        })
      } catch (error) {
        if (restoreError)
          throw new AggregateError([restoreError, error], 'Failed to restore pnpm workspace metadata', { cause: error })
        throw error
      }
      if (restoreError) throw restoreError
    }
  } catch (restoreError) {
    if (actionFailed)
      throw new AggregateError(
        [actionError, restoreError],
        'Deployment failed and pnpm workspace metadata could not be restored',
        { cause: restoreError },
      )
    throw restoreError
  }
  if (actionFailed) throw actionError
  return result
}
