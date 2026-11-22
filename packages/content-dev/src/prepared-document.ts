import { sha256Hex } from '@arcadia-eternity/const'
import { readFile, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  environmentManifestDocument,
  environmentProjectDocument,
  normalizeEnvironmentDocument,
} from './debug-environments.ts'
export { environmentProjectDocument } from './debug-environments.ts'
import { contentError, readJson } from './workspace-materials.ts'
import { errorCode, type UnknownRecord } from './types.ts'

export function parseManifestDraft(text: string) {
  const document = environmentProjectDocument(JSON.parse(text))
  return { document, revision: sha256Hex(text) }
}

export function preparedDocument(metadata: UnknownRecord, legacyManifest: string) {
  if (metadata.format !== 'arcadia.environment-installation/1') throw contentError('ENVIRONMENT_INSTALLATION_INVALID')
  if (metadata.document !== undefined) {
    const document = normalizeEnvironmentDocument(metadata.document)
    if (document.id !== metadata.installationId) throw contentError('ENVIRONMENT_ID_MISMATCH')
    return document
  }
  const draft = parseManifestDraft(legacyManifest)
  if (draft.revision !== metadata.draftRevision || draft.document.id !== metadata.installationId)
    throw contentError('ENVIRONMENT_PREPARATION_REQUIRED')
  return draft.document
}

/** Managed projects read their applied rules. Plain npm projects may install one rules recipe. */
export async function readInstalledEnvironmentDocument(directory: string, contentRevision?: string) {
  const manifest = await readFile(join(directory, 'package.json'), 'utf8')
  const project = JSON.parse(manifest)
  const receipt = await readJson(join(directory, '.arcadia-prepared.json')).catch(error => {
    if (errorCode(error) !== 'ENOENT') throw error
    if (project.arcadiaEnvironment) throw contentError('ENVIRONMENT_PREPARATION_REQUIRED')
    return undefined
  })
  if (receipt && contentRevision !== undefined && receipt.contentRevision !== contentRevision)
    throw contentError('ENVIRONMENT_PREPARATION_REQUIRED')
  if (receipt) return preparedDocument(receipt, manifest)
  // An ordinary npm project can select a rules recipe as a direct dependency.
  const root = await realpath(directory)
  let selected: ReturnType<typeof parseManifestDraft>['document'] | undefined
  for (const name of Object.keys(project.dependencies ?? {})) {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) continue
    const file = resolve(root, 'node_modules', name, 'package.json')
    const installed = await realpath(file).catch(error => {
      if (errorCode(error) !== 'ENOENT') throw error
    })
    if (!installed) continue
    if (installed !== file) throw contentError('MATERIAL_PATH_ESCAPE')
    const pkg = await readJson(file)
    if (!pkg.arcadiaEnvironment) continue
    if (pkg.name !== name) throw contentError('ENVIRONMENT_MANIFEST_INVALID')
    if (selected) throw contentError('ENVIRONMENT_PRESET_AMBIGUOUS', '项目依赖多个环境包，请显式选择环境声明。')
    selected = environmentManifestDocument(pkg)
  }
  return selected
}
