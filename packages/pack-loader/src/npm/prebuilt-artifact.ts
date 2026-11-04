import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import { parse } from 'es-module-lexer/minimal/js'
import type { EffectModuleArtifact } from '@arcadia-eternity/battle/v4/sandbox/effects'
import { fail } from '../works/model'

const maxSourceBytes = 4 * 1024 * 1024
// JSON escaping may expand source bytes substantially; both the envelope and
// decoded source have independent bounds. There is no compilation/evaluation.
const maxArtifactBytes = maxSourceBytes * 6 + 1024

export function validatePrebuiltEffectModule(value: unknown, packageId: string): Readonly<EffectModuleArtifact> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('NPM_ARTIFACT_INVALID', packageId, 'Expected an effect artifact object')
  const artifact = value as Record<string, unknown>
  if (
    Object.keys(artifact).some(key => !['format', 'version', 'sdkApi', 'packageId', 'source'].includes(key)) ||
    artifact.format !== 'arcadia.effect-module' ||
    artifact.version !== 1 ||
    artifact.sdkApi !== 2 ||
    artifact.packageId !== packageId ||
    typeof artifact.source !== 'string' ||
    !artifact.source.length ||
    Buffer.byteLength(artifact.source) > maxSourceBytes
  )
    fail('NPM_ARTIFACT_INVALID', packageId, 'Incompatible, misidentified or oversized effect artifact')
  let imports: ReturnType<typeof parse>[0]
  try {
    ;[imports] = parse(artifact.source)
  } catch {
    return fail('NPM_ARTIFACT_INVALID', packageId, 'Malformed effect module text')
  }
  if (imports.some(entry => entry.d !== -2))
    fail('NPM_ARTIFACT_IMPORT', packageId, 'Prebuilt effect artifacts must have a closed dependency graph')
  // Deliberately do not run top-level code or factories to prove their exports:
  // dynamic validity is checked by the actual sandbox consumer, never this host.
  return Object.freeze({
    format: 'arcadia.effect-module',
    version: 1,
    sdkApi: 2,
    packageId,
    source: artifact.source,
  })
}

export async function readPrebuiltEffectModule(file: string, root: string, packageId: string) {
  const boundary = await realpath(root),
    source = await realpath(file)
  const path = relative(boundary, source),
    info = await lstat(file)
  if (
    isAbsolute(path) ||
    path === '..' ||
    path.startsWith('../') ||
    path.startsWith('..\\') ||
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > maxArtifactBytes
  )
    fail('NPM_ARTIFACT_FILE', packageId, 'Expected a bounded artifact file inside the captured installation')
  const bytes = await readFile(file)
  if (bytes.byteLength > maxArtifactBytes) fail('NPM_ARTIFACT_FILE', packageId, 'Effect artifact exceeds size limit')
  let value: unknown
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch {
    return fail('NPM_ARTIFACT_INVALID', packageId, 'Malformed effect artifact JSON')
  }
  return validatePrebuiltEffectModule(value, packageId)
}
