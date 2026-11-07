import { digestJson } from '@arcadia-eternity/pack-loader/native'
import { validateEnvironmentRules } from '@arcadia-eternity/content-dev/environment-rules'
import { PlayerSchema, parseWithErrors } from '@arcadia-eternity/schema'
import type { PersonalEnvironmentReference } from '@arcadia-eternity/protocol'
import { EnvironmentError, type EnvironmentAdmissionRules } from './environments'

export interface PersonalEnvironmentLease {
  readonly personal: PersonalEnvironmentReference
  readonly descriptor: PersonalEnvironmentReference['descriptor']
  readonly executionPolicy: 'peer'
  readonly isNpm: true
  readonly rules: EnvironmentAdmissionRules
  release(): Promise<void>
}
function invalid(): never {
  throw new EnvironmentError('PERSONAL_ENVIRONMENT_INVALID')
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key))
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && !/\p{Cc}/u.test(value)
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

/** Only a small, fixed reference enters signaling. It carries no author modules or installation instructions. */
export async function acquirePersonalEnvironment(value: unknown): Promise<PersonalEnvironmentLease> {
  if (
    !record(value) ||
    Buffer.byteLength(JSON.stringify(value)) > 65536 ||
    !exact(value, ['kind', 'protocolVersion', 'descriptor', 'rules', 'source']) ||
    value.kind !== 'personal' ||
    value.protocolVersion !== 1
  )
    invalid()
  const d = value.descriptor
  if (
    !record(d) ||
    !exact(d, [
      'id',
      'protocolVersion',
      'executionPolicy',
      'peerRevision',
      'runtime',
      'packages',
      'resourceRevision',
      'resources',
      'remoteResources',
    ]) ||
    d.protocolVersion !== 1 ||
    d.executionPolicy !== 'peer' ||
    !hash(d.id) ||
    !hash(d.resourceRevision) ||
    !identifier(d.peerRevision) ||
    !record(d.runtime) ||
    !exact(d.runtime, ['kind', 'contentRevision', 'coreBuildId', 'registryBuildId']) ||
    d.runtime.kind !== 'native-v4' ||
    !identifier(d.runtime.contentRevision) ||
    !identifier(d.runtime.coreBuildId) ||
    !identifier(d.runtime.registryBuildId) ||
    !Array.isArray(d.packages) ||
    d.packages.length > 32 ||
    !Array.isArray(d.resources) ||
    d.resources.length !== 0 ||
    (d.remoteResources !== undefined && (!Array.isArray(d.remoteResources) || d.remoteResources.length !== 0))
  )
    invalid()
  if (
    !d.peerRevision.startsWith(`${d.runtime.contentRevision}/effects:`) ||
    !hash(d.peerRevision.slice(`${d.runtime.contentRevision}/effects:`.length))
  )
    invalid()
  const namespaces = new Set<string>(),
    projects = new Set<string>()
  for (const pkg of d.packages) {
    if (
      !record(pkg) ||
      !exact(pkg, ['name', 'version', 'projectId', 'namespace']) ||
      !identifier(pkg.name) ||
      !identifier(pkg.version) ||
      !identifier(pkg.projectId) ||
      !identifier(pkg.namespace) ||
      projects.has(pkg.projectId) ||
      namespaces.has(pkg.namespace)
    )
      invalid()
    namespaces.add(pkg.namespace)
    projects.add(pkg.projectId)
  }
  const source = value.source
  if (!record(source)) invalid()
  if (source.kind === 'file') {
    if (!exact(source, ['kind', 'name']) || !identifier(source.name) || /[\\/]/.test(source.name)) invalid()
  } else if (source.kind === 'https') {
    if (!exact(source, ['kind', 'url']) || typeof source.url !== 'string' || source.url.length > 2048) invalid()
    let url: URL
    try {
      url = new URL(source.url)
    } catch {
      invalid()
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) invalid()
  } else invalid()
  const rules = validateEnvironmentRules(value.rules)
  if (
    d.id !==
    (await digestJson({
      runtime: d.runtime,
      peerRevision: d.peerRevision,
      resourceRevision: d.resourceRevision,
      rules,
      packages: d.packages,
    }))
  )
    invalid()
  const personal = structuredClone({ ...value, rules }) as unknown as PersonalEnvironmentReference
  return {
    personal,
    descriptor: personal.descriptor,
    isNpm: true,
    executionPolicy: 'peer',
    rules,
    release: async () => {},
  }
}

/** Signal transport checks size/shape only. The player's prepared catalog validates content and learnsets. */
export function validatePersonalTeam(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6 || Buffer.byteLength(JSON.stringify(value)) > 32768)
    throw new Error('INVALID_TEAM')
  const inspect = (entry: unknown, depth: number) => {
    if (depth > 4) throw new Error('INVALID_TEAM')
    if (typeof entry === 'string' && (entry.length > 256 || /\p{Cc}/u.test(entry))) throw new Error('INVALID_TEAM')
    if (typeof entry === 'number' && !Number.isFinite(entry)) throw new Error('INVALID_TEAM')
    if (entry && typeof entry === 'object') {
      if (Object.keys(entry).length > 32) throw new Error('INVALID_TEAM')
      for (const [key, child] of Object.entries(entry)) {
        if (['__proto__', 'constructor', 'prototype', 'maxHp', 'currentHp', 'hp'].includes(key) && depth === 1)
          throw new Error('INVALID_TEAM')
        inspect(child, depth + 1)
      }
    }
  }
  inspect(value, 0)
  const parsed = parseWithErrors(PlayerSchema, { id: 'p'.repeat(21), name: 'team', team: value }).team
  if (
    new Set(parsed.map(pet => pet.id)).size !== parsed.length ||
    parsed.some(pet => pet.level > 100 || Object.values(pet.evs).reduce((sum, amount) => sum + amount, 0) > 510)
  )
    throw new Error('INVALID_TEAM')
  return parsed
}
