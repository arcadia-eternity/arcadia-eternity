import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

const base = '@arcadia-eternity/data-pack-base'

// The managed workspace owns the installation even when the server is stopped.
// Earlier official hosts already have a durable binding; keep its environment ID.
export async function openBuiltinEnvironment({ workspace, library, rules, validate, legacyBuiltinId }) {
  const file = join(workspace.root, 'builtin-environment.json')
  const drafts = await workspace.listDrafts()
  const saved = await readFile(file, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error
  })
  const marker = saved && JSON.parse(saved)
  const legacy = !saved && drafts.some(item => item.document.id === 'desktop-host') && (await legacyBuiltinId())
  const id = saved
    ? marker.id
    : legacy ||
      (drafts.some(item => item.document.id === 'builtin-server') ? 'builtin-' + randomUUID() : 'builtin-server')
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id)) throw new Error('INVALID_BUILTIN_ENVIRONMENT')
  async function saveMarker(initialized) {
    const temporary = file + '.' + randomUUID()
    await writeFile(temporary, JSON.stringify({ id, initialized }), { flag: 'wx' })
    await rename(temporary, file)
  }
  if (!saved) await saveMarker(false)
  const current = drafts.find(item => item.document.id === id)
  const lease = await library.acquireDefaultProject()
  try {
    const version = JSON.parse(
      await readFile(join(lease.directory, 'node_modules', base, 'package.json'), 'utf8'),
    ).version
    const document = {
      schemaVersion: 2,
      id,
      name: '默认环境',
      packages: { [base]: version },
      sources: [],
      rules,
      requires: {},
    }
    const existing = current && (await workspace.listInstallations(id))[0]
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
    if (
      !isDeepStrictEqual(current?.document, document) ||
      existing?.status !== 'ready' ||
      existing.draftRevision !== current.revision
    )
      await workspace.prepareEnvironment(
        { environmentId: id, document, expectedRevision: current?.revision ?? null, projectDirectory: lease.directory },
        validate,
      )
    if (!marker?.initialized) await saveMarker(true)
    return { workspace, id }
  } finally {
    await lease.release()
  }
}
