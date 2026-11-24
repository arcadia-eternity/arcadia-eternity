import { join } from 'node:path'

const base = '@arcadia-eternity/data-pack-base'

// Keep manual and scheduled requests in order through activation and rollback.
export function createOfficialContentUpdater(library, synchronize) {
  let previous = Promise.resolve()
  return options => {
    const current = previous.then(async () => {
      options?.signal?.throwIfAborted()
      const id = await library.updateOfficialPackage(options)
      options?.signal?.throwIfAborted()
      if (id && id === library.pendingOfficialUpdateId) await synchronize()
      return id
    })
    previous = current.catch(() => {})
    return current
  }
}

// A restart can resume a pending activation. Repair any official presets already switched
// before reporting a manual update failure or serving an offline startup.
export async function activateOfficialEnvironments(library, synchronize, reportFailure = false) {
  const pending = library.pendingOfficialUpdateId
  try {
    await synchronize()
    await library.finishOfficialUpdate(pending)
  } catch (error) {
    if (!(await library.rollbackOfficialUpdate(pending))) throw error
    await synchronize()
    if (reportFailure) throw error
    console.warn('Restored previous official base after activation failed', error)
  }
}

// The managed workspace owns the installation even when the server is stopped.
export async function openBuiltinEnvironment({
  workspace,
  library,
  catalog,
  previousEnvironmentId,
  validate,
  synchronizeShippedEnvironments,
}) {
  const lease = await library.acquireDefaultProject()
  try {
    await synchronizeShippedEnvironments(
      workspace,
      catalog,
      previousEnvironmentId ? { [catalog.defaultEnvironment]: previousEnvironmentId } : {},
      async (document, expectedRevision) => {
        const input = { environmentId: document.id, document, expectedRevision }
        if (
          Object.keys(document.packages).length === 1 &&
          Object.hasOwn(document.packages, base) &&
          !document.sources.length
        )
          return workspace.prepareEnvironment({ ...input, projectDirectory: lease.directory }, validate)
        const project = await library.prepareEnvironmentProject(document, { offline: true })
        try {
          return await workspace.prepareEnvironment({ ...input, projectDirectory: project.directory }, validate)
        } finally {
          await project.release()
        }
      },
      join(lease.directory, 'node_modules', base),
    )
    return { workspace, id: catalog.defaultEnvironment }
  } finally {
    await lease.release()
  }
}
