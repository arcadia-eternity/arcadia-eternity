import type { SandboxEnvironment } from '@arcadia-eternity/battle/sandbox'
import type { ServerEnvironmentDescriptor } from '@arcadia-eternity/protocol'
import { digestJson } from '@arcadia-eternity/pack-loader/native'
import { Value } from '@sinclair/typebox/value'
import { MarkSchema, SkillSchema, SpeciesSchema } from '@arcadia-eternity/schema'
import { environmentServerUrl, prepareServerEnvironment } from './serverEnvironment'
import { readResourceBytes, RESOURCE_MAX_BYTES } from './resourceTransport'
import { validateEnvironmentDescriptor, validateMetadataTree } from './serverContentValidation'

function invalid(): never {
  throw new Error('对战环境材料缺失、版本不一致或不兼容，请重新准备')
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key))

/** Validate a captured recipe, without importing or evaluating any author code in the page. */
export async function validatePeerMaterials(
  value: unknown,
  descriptor: ServerEnvironmentDescriptor,
): Promise<SandboxEnvironment> {
  if (
    !record(value) ||
    !exact(value, ['protocolVersion', 'environmentId', 'resourceRevision', 'runtime', 'packages', 'environment']) ||
    value.protocolVersion !== 1 ||
    value.environmentId !== descriptor.id ||
    value.resourceRevision !== descriptor.resourceRevision ||
    !record(value.runtime) ||
    value.runtime.kind !== descriptor.runtime.kind ||
    value.runtime.contentRevision !== descriptor.runtime.contentRevision ||
    value.runtime.coreBuildId !== descriptor.runtime.coreBuildId ||
    value.runtime.registryBuildId !== descriptor.runtime.registryBuildId ||
    JSON.stringify(value.packages) !== JSON.stringify(descriptor.packages)
  )
    invalid()
  const environment = value.environment
  if (
    !record(environment) ||
    !exact(environment, ['revision', 'data', 'modules']) ||
    environment.revision !== descriptor.peerRevision ||
    !record(environment.data) ||
    !exact(environment.data, ['species', 'skills', 'marks', 'behaviors']) ||
    !Array.isArray(environment.modules) ||
    environment.modules.length > 32
  )
    invalid()
  validateMetadataTree(environment.data)
  const data = environment.data
  for (const [kind, schema] of [
    ['species', SpeciesSchema],
    ['skills', SkillSchema],
    ['marks', MarkSchema],
  ] as const) {
    const rows = data[kind]
    if (!Array.isArray(rows)) invalid()
    const ids = new Set<string>()
    for (const row of rows) {
      if (!record(row) || typeof row.id !== 'string' || ids.has(row.id)) invalid()
      // Captured source records intentionally omit schema defaults. Validate a copy, retaining the exact recipe.
      if (!Value.Check(schema, Value.Default(schema, structuredClone(row)))) invalid()
      ids.add(row.id)
    }
  }
  if (data.behaviors !== undefined && !Array.isArray(data.behaviors)) invalid()
  const packages = new Set<string>()
  const namespaces = new Set<string>()
  for (const entry of environment.modules) {
    if (
      !record(entry) ||
      !exact(entry, ['artifact', 'namespace', 'role']) ||
      typeof entry.namespace !== 'string' ||
      entry.namespace.length > 256 ||
      namespaces.has(entry.namespace) ||
      !['catalog', 'behaviors'].includes(String(entry.role)) ||
      !record(entry.artifact)
    )
      invalid()
    const artifact = entry.artifact
    if (
      !exact(artifact, ['format', 'version', 'sdkApi', 'packageId', 'source']) ||
      artifact.format !== 'arcadia.effect-module' ||
      artifact.version !== 1 ||
      artifact.sdkApi !== 2 ||
      typeof artifact.packageId !== 'string' ||
      !artifact.packageId ||
      artifact.packageId.length > 256 ||
      packages.has(artifact.packageId) ||
      typeof artifact.source !== 'string' ||
      !artifact.source ||
      new TextEncoder().encode(artifact.source).byteLength > 4 * 1024 * 1024
    )
      invalid()
    if (
      entry.namespace === ''
        ? entry.role !== 'catalog'
        : entry.role !== 'behaviors' || !descriptor.packages.some(pkg => pkg.namespace === entry.namespace)
    )
      invalid()
    packages.add(artifact.packageId)
    namespaces.add(entry.namespace)
  }
  // Packages containing data only need no VM. A referenced code export does need its captured module.
  for (const behavior of (data.behaviors ?? []) as unknown[]) {
    if (!record(behavior) || !record(behavior.implementation) || typeof behavior.implementation.exportId !== 'string')
      invalid()
    const exportId = behavior.implementation.exportId
    if (exportId.includes(':') && !namespaces.has(exportId.slice(0, exportId.indexOf(':')))) invalid()
  }
  // Reuse the existing loader's captured Effect identity; this is not a new install or per-file lock format.
  if (environment.revision !== `${descriptor.runtime.contentRevision}/effects:${await digestJson(environment.modules)}`)
    invalid()
  return environment as unknown as SandboxEnvironment
}

/** Acquire the exact room recipe from its server. Desktop selections and author modules are never opened here. */
export async function preparePeerEnvironment(
  server: string,
  descriptor: ServerEnvironmentDescriptor,
  request: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  validateEnvironmentDescriptor(descriptor)
  if (typeof descriptor.peerRevision !== 'string' || !descriptor.peerRevision || descriptor.peerRevision.length > 512)
    invalid()
  const [environment, display] = await Promise.all([
    readResourceBytes(
      `${environmentServerUrl(server)}/api/v1/environments/${descriptor.id}/peer-materials`,
      { signal, maxBytes: RESOURCE_MAX_BYTES },
      request,
    ).then(bytes =>
      validatePeerMaterials(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), descriptor),
    ),
    prepareServerEnvironment(server, descriptor, request, signal),
  ])
  for (const kind of ['species', 'skills', 'marks'] as const) {
    const ids = new Set(environment.data[kind].map(raw => (raw as { id: string }).id))
    if (ids.size !== display.content[kind].length || display.content[kind].some(row => !ids.has(row.id))) invalid()
  }
  signal?.throwIfAborted()
  return {
    ...display,
    environment,
    acceptance: { ...display.acceptance, peerRevision: environment.revision },
    readiness: { ...display.readiness, execution: 'prepared' as const },
  }
}
