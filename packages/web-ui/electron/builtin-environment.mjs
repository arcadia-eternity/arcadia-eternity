import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

const base = '@arcadia-eternity/data-pack-base'

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
// Older hosts identify their previous installation through the local marker.
export async function openBuiltinEnvironment({
  workspace,
  library,
  catalog,
  validate,
  legacyBuiltinId,
  synchronizeShippedEnvironments,
}) {
  const file = join(workspace.root, 'builtin-environment.json')
  const drafts = await workspace.listDrafts()
  const saved = await readFile(file, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error
  })
  const marker = saved && JSON.parse(saved)
  const legacy = !saved && drafts.some(item => item.document.id === 'desktop-host') && (await legacyBuiltinId())
  const mapped = workspace.builtinEnvironmentIds?.[catalog.defaultEnvironment]
  const previousId = mapped ?? marker?.id ?? legacy
  const id = catalog.defaultEnvironment
  async function saveMarker() {
    const temporary = file + '.' + randomUUID()
    await writeFile(temporary, JSON.stringify({ id, initialized: true }), { flag: 'wx' })
    await rename(temporary, file)
  }
  const current = drafts.find(item => item.document.id === previousId)
  const lease = await library.acquireDefaultProject()
  try {
    const document = { ...catalog.environments.find(doc => doc.id === catalog.defaultEnvironment), id: previousId }
    const existing = current && (await workspace.listInstallations(previousId))[0]
    if (!marker?.initialized && current && !isDeepStrictEqual(current.document, document)) {
      // Preserve edits made while earlier releases still allowed editing the official host.
      const previous =
        current.document.name === '本机服务器环境' ? { ...current.document, name: document.name } : current.document
      if (!isDeepStrictEqual(previous, document)) {
        const copy = {
          ...current.document,
          id: 'previous-builtin-' + current.revision.slice(0, 20),
          name: current.document.name,
        }
        const preserved = drafts.find(item => item.document.id === copy.id)
        if (preserved && !isDeepStrictEqual(preserved.document, copy))
          throw new Error('BUILTIN_MIGRATION_COPY_CONFLICT')
        if (!preserved && existing?.status !== 'ready')
          await workspace.saveDraft({ document: copy, expectedRevision: null })
        else if (!preserved)
          await workspace.prepareEnvironment(
            { environmentId: copy.id, expectedRevision: null, document: copy, projectDirectory: existing.directory },
            validate,
          )
      }
    }
    await synchronizeShippedEnvironments(
      workspace,
      catalog,
      previousId ? { [id]: previousId } : {},
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
    if (!marker?.initialized || marker.id !== id) await saveMarker()
    return { workspace, id }
  } finally {
    await lease.release()
  }
}
