import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeEnvironmentDocument } from './debug-environments.ts'
import { contentError, readJson } from './workspace-materials.ts'
import { errorCode, isRecord, type UnknownRecord } from './types.ts'

export function parseManifestDraft(text: string) {
  const manifest = JSON.parse(text) as UnknownRecord
  if (!isRecord(manifest.arcadiaEnvironment) || !isRecord(manifest.dependencies))
    throw contentError('ENVIRONMENT_MANIFEST_INVALID')
  const sources = manifest.arcadiaEnvironment.sources
  if (!Array.isArray(sources)) throw contentError('ENVIRONMENT_MANIFEST_INVALID')
  const document = normalizeEnvironmentDocument({
    ...manifest.arcadiaEnvironment,
    packages: Object.fromEntries(Object.entries(manifest.dependencies).filter(([name]) => !sources.includes(name))),
  })
  return { document, revision: createHash('sha256').update(text).digest('hex') }
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

/** Plain npm projects use compatibility defaults. Managed projects must have prepared rules. */
export async function readInstalledEnvironmentDocument(directory: string, contentRevision?: string) {
  const manifest = await readFile(join(directory, 'package.json'), 'utf8')
  const receipt = await readJson(join(directory, '.arcadia-prepared.json')).catch(error => {
    if (errorCode(error) !== 'ENOENT') throw error
    if (JSON.parse(manifest).arcadiaEnvironment) throw contentError('ENVIRONMENT_PREPARATION_REQUIRED')
    return undefined
  })
  if (receipt && contentRevision !== undefined && receipt.contentRevision !== contentRevision)
    throw contentError('ENVIRONMENT_PREPARATION_REQUIRED')
  return receipt && preparedDocument(receipt, manifest)
}
