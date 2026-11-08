import type { SandboxEnvironment } from '@arcadia-eternity/battle/sandbox'
import type {
  NativeRuntimeIdentity,
  PersonalEnvironmentReference,
  ServerEnvironmentAcceptance,
  ServerEnvironmentContent,
  ServerEnvironmentDescriptor,
} from '@arcadia-eternity/protocol'
import { digestJson } from '@arcadia-eternity/pack-loader/native'
import { Value } from '@sinclair/typebox/value'
import { assertEnvironmentTeam, validateEnvironmentRules } from '@arcadia-eternity/content-sdk/environment-rules'
import { PlayerSchema, SpeciesSchema, parseWithErrors, type PetSchemaType } from '@arcadia-eternity/schema'
import { validatePeerMaterials } from './peerEnvironment'
import { readResourceBytes, registerOwnedResource, RESOURCE_MAX_BYTES } from './resourceTransport'
import {
  validateEnvironmentContent,
  validateEnvironmentDescriptor,
  validateMetadataTree,
} from './serverContentValidation'

export const PERSONAL_ENVIRONMENT_MAX_BYTES = 128 * 1024 * 1024
/** Network acquisition uses the shared bounded transport; larger bundles can be explicitly imported as files. */
export const PERSONAL_ENVIRONMENT_DOWNLOAD_MAX_BYTES = RESOURCE_MAX_BYTES
const REFERENCE_MAX_BYTES = 64 * 1024
const allowedMime = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'audio/ogg',
  'audio/mpeg',
  'application/x-shockwave-flash',
])
type PersonalRules = NonNullable<PersonalEnvironmentReference['rules']>
type PersonalSource = PersonalEnvironmentReference['source']
interface PersonalEnvironmentAsset {
  id: string
  mime: string
  data: string
}
export interface PersonalEnvironmentBundle {
  format: 'arcadia.personal-environment'
  version: 1
  descriptor: ServerEnvironmentDescriptor
  rules: PersonalRules
  environment: SandboxEnvironment
  content: ServerEnvironmentContent
  assets?: PersonalEnvironmentAsset[]
}
export interface PersonalEnvironmentCapture {
  environment: SandboxEnvironment
  content: ServerEnvironmentContent
  runtime: NativeRuntimeIdentity
  packages: ServerEnvironmentDescriptor['packages']
  assets?: PersonalEnvironmentAsset[]
}
export interface PreparedPersonalEnvironment {
  /** Original portable payload for explicit export; resolved Blob URLs appear only in content. */
  bundle: PersonalEnvironmentBundle
  reference: PersonalEnvironmentReference
  environment: SandboxEnvironment
  content: ServerEnvironmentContent
  acceptance: ServerEnvironmentAcceptance
  release(): void
}

function invalid(): never {
  throw new Error('个人挑战环境文件无效、材料不完整或版本不一致')
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key))
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength

/** Check finite plain JSON before serialization, including ignored fields and long executable/media strings. */
function boundedJson(value: unknown): string {
  let nodes = 0
  let characters = 0
  const ancestors = new Set<object>()
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 500_000 || depth > 32) invalid()
    if (typeof item === 'string') {
      characters += item.length
      if (characters > PERSONAL_ENVIRONMENT_MAX_BYTES) invalid()
      return
    }
    if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) return
    if (!item || typeof item !== 'object' || ancestors.has(item)) invalid()
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) invalid()
    const entries = Object.entries(item)
    if (entries.length > 20_000) invalid()
    ancestors.add(item)
    for (const [key, child] of entries) {
      if (key.length > 256 || ['__proto__', 'constructor', 'prototype'].includes(key)) invalid()
      characters += key.length
      visit(child, depth + 1)
    }
    ancestors.delete(item)
  }
  visit(value, 0)
  const text = JSON.stringify(value)
  if (byteLength(text) > PERSONAL_ENVIRONMENT_MAX_BYTES) invalid()
  return text
}
function captureJson(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.length > PERSONAL_ENVIRONMENT_MAX_BYTES || byteLength(value) > PERSONAL_ENVIRONMENT_MAX_BYTES) invalid()
    const parsed: unknown = JSON.parse(value)
    boundedJson(parsed)
    return parsed
  }
  return JSON.parse(boundedJson(value)) as unknown
}

function checkedSource(value: unknown): PersonalSource {
  if (!record(value)) invalid()
  if (value.kind === 'file') {
    if (
      !exact(value, ['kind', 'name']) ||
      typeof value.name !== 'string' ||
      !value.name ||
      value.name.length > 256 ||
      /[/\\\p{Cc}]/u.test(value.name)
    )
      invalid()
    return { kind: 'file', name: value.name }
  }
  if (
    value.kind !== 'https' ||
    !exact(value, ['kind', 'url']) ||
    typeof value.url !== 'string' ||
    value.url.length > 8192
  )
    invalid()
  const url = new URL(value.url)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) invalid()
  return { kind: 'https', url: url.toString() }
}
function descriptorIdentity(descriptor: ServerEnvironmentDescriptor, rules: PersonalRules) {
  return {
    runtime: descriptor.runtime,
    peerRevision: descriptor.peerRevision,
    resourceRevision: descriptor.resourceRevision,
    rules,
    packages: descriptor.packages,
  }
}
async function checkedDescriptor(value: unknown, rules: PersonalRules): Promise<ServerEnvironmentDescriptor> {
  validateEnvironmentDescriptor(value)
  const descriptor = value
  if (
    !exact(descriptor as unknown as Record<string, unknown>, [
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
    descriptor.executionPolicy !== 'peer' ||
    !descriptor.peerRevision ||
    descriptor.packages.length > 32 ||
    descriptor.resources.length ||
    descriptor.remoteResources?.length ||
    !exact(descriptor.runtime as unknown as Record<string, unknown>, [
      'kind',
      'contentRevision',
      'coreBuildId',
      'registryBuildId',
    ]) ||
    descriptor.packages.some(
      pkg => !exact(pkg as unknown as Record<string, unknown>, ['name', 'version', 'projectId', 'namespace']),
    ) ||
    descriptor.id !== (await digestJson(descriptorIdentity(descriptor, rules)))
  )
    invalid()
  return descriptor
}
async function checkedReference(value: unknown): Promise<PersonalEnvironmentReference> {
  validateMetadataTree(value)
  if (
    !record(value) ||
    !exact(value, ['kind', 'protocolVersion', 'descriptor', 'rules', 'source']) ||
    value.kind !== 'personal' ||
    value.protocolVersion !== 1 ||
    byteLength(JSON.stringify(value)) > REFERENCE_MAX_BYTES
  )
    invalid()
  const rules = validateEnvironmentRules(value.rules)
  const descriptor = await checkedDescriptor(value.descriptor, rules)
  return { kind: 'personal', protocolVersion: 1, descriptor, rules, source: checkedSource(value.source) }
}

function checkedAssets(value: unknown): Map<string, { mime: string; bytes: Uint8Array }> {
  if (value === undefined) return new Map()
  if (!Array.isArray(value) || value.length > 4096) invalid()
  const assets = new Map<string, { mime: string; bytes: Uint8Array }>()
  for (const asset of value) {
    if (
      !record(asset) ||
      !exact(asset, ['id', 'mime', 'data']) ||
      typeof asset.id !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,255}$/.test(asset.id) ||
      assets.has(asset.id) ||
      typeof asset.mime !== 'string' ||
      !allowedMime.has(asset.mime) ||
      typeof asset.data !== 'string' ||
      !asset.data ||
      asset.data.length > Math.ceil(RESOURCE_MAX_BYTES / 3) * 4 ||
      asset.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.data)
    )
      invalid()
    const decoded = atob(asset.data)
    if (!decoded.length || decoded.length > RESOURCE_MAX_BYTES || btoa(decoded) !== asset.data) invalid()
    const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0))
    assets.set(asset.id, { mime: asset.mime, bytes })
  }
  return assets
}
function normalizedAssets(assets: PersonalEnvironmentAsset[] | undefined): PersonalEnvironmentAsset[] {
  return [...(assets ?? [])].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
}
/** Personal resourceRevision identifies the whole portable snapshot, including private rules data and embedded bytes. */
function portableSnapshotRevision(
  content: ServerEnvironmentContent,
  environment: SandboxEnvironment,
  assets: PersonalEnvironmentAsset[] | undefined,
) {
  return digestJson({ content, data: environment.data, assets: normalizedAssets(assets) })
}
function mapMedia(content: ServerEnvironmentContent, resolve: (value: unknown) => string): ServerEnvironmentContent {
  const result = structuredClone(content)
  for (const kind of ['species', 'skills', 'marks'] as const) {
    for (const row of result[kind]) {
      const presentation = row.presentation
      if (!presentation) continue
      for (const key of ['icon', 'portrait', 'cry', 'sfx', 'background', 'music'] as const)
        if (presentation[key] !== undefined) presentation[key] = resolve(presentation[key])
      if (presentation.battle) {
        presentation.battle.source = resolve(presentation.battle.source)
        if (presentation.battle.fallback !== undefined)
          presentation.battle.fallback = resolve(presentation.battle.fallback)
      }
    }
  }
  return result
}
function portableMedia(value: unknown, assets: ReadonlyMap<string, unknown>): string {
  if (typeof value !== 'string') invalid()
  if (value.startsWith('arcadia-resource:')) {
    if (!assets.has(value.slice('arcadia-resource:'.length))) invalid()
    return value
  }
  if (!/^https?:\/\//.test(value)) invalid()
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) invalid()
  return value
}

async function validateBundle(value: unknown) {
  if (
    !record(value) ||
    !exact(value, ['format', 'version', 'descriptor', 'rules', 'environment', 'content', 'assets']) ||
    value.format !== 'arcadia.personal-environment' ||
    value.version !== 1
  )
    invalid()
  validateMetadataTree(value.rules ?? { schemaVersion: 1 })
  const rules = validateEnvironmentRules(value.rules)
  const descriptor = await checkedDescriptor(value.descriptor, rules)
  validateEnvironmentContent(value.content)
  const environment = await validatePeerMaterials(
    {
      protocolVersion: 1,
      environmentId: descriptor.id,
      resourceRevision: descriptor.resourceRevision,
      runtime: descriptor.runtime,
      packages: descriptor.packages,
      environment: value.environment,
    },
    descriptor,
  )
  for (const kind of ['species', 'skills', 'marks'] as const) {
    const ids = new Set(environment.data[kind].map(raw => (raw as { id: string }).id))
    if (ids.size !== value.content[kind].length || value.content[kind].some(row => !ids.has(row.id))) invalid()
  }
  const assets = checkedAssets(value.assets)
  if (
    descriptor.resourceRevision !==
    (await portableSnapshotRevision(value.content, environment, value.assets as PersonalEnvironmentAsset[] | undefined))
  )
    invalid()
  mapMedia(value.content, reference => portableMedia(reference, assets))
  return { bundle: { ...value, rules } as unknown as PersonalEnvironmentBundle, assets }
}

/** Capture only explicitly supplied materials. This never reads paths, fetches media or evaluates author modules. */
export async function createPersonalEnvironmentBundle(
  capture: PersonalEnvironmentCapture,
  inputRules?: PersonalRules,
  signal?: AbortSignal,
): Promise<PersonalEnvironmentBundle> {
  signal?.throwIfAborted()
  const fixed = captureJson({
    environment: capture.environment,
    content: capture.content,
    runtime: capture.runtime,
    packages: capture.packages,
    ...(capture.assets !== undefined ? { assets: capture.assets } : {}),
  }) as PersonalEnvironmentCapture
  const rules = validateEnvironmentRules(inputRules)
  validateEnvironmentContent(fixed.content)
  checkedAssets(fixed.assets)
  const portableAssets = normalizedAssets(fixed.assets)
  const descriptor: ServerEnvironmentDescriptor = {
    id: '',
    protocolVersion: 1,
    executionPolicy: 'peer',
    peerRevision: fixed.environment.revision,
    runtime: fixed.runtime,
    packages: fixed.packages,
    resourceRevision: await portableSnapshotRevision(fixed.content, fixed.environment, portableAssets),
    resources: [],
  }
  descriptor.id = await digestJson(descriptorIdentity(descriptor, rules))
  const bundle: PersonalEnvironmentBundle = {
    format: 'arcadia.personal-environment',
    version: 1,
    descriptor,
    rules,
    environment: fixed.environment,
    content: fixed.content,
    ...(fixed.assets ? { assets: portableAssets } : {}),
  }
  await validateBundle(bundle)
  boundedJson(bundle)
  signal?.throwIfAborted()
  return bundle
}

/** Serialization is transport only. Import validates the complete bundle again before use. */
export function encodePersonalEnvironmentBundle(bundle: PersonalEnvironmentBundle): string {
  return boundedJson(bundle)
}

export async function parsePersonalEnvironmentBundle(
  raw: unknown,
  source: PersonalSource = { kind: 'file', name: 'environment.arcadia.json' },
  signal?: AbortSignal,
): Promise<PreparedPersonalEnvironment> {
  signal?.throwIfAborted()
  const fixedSource = checkedSource(source)
  const { bundle, assets } = await validateBundle(captureJson(raw))
  const reference = await checkedReference({
    kind: 'personal',
    protocolVersion: 1,
    descriptor: bundle.descriptor,
    rules: bundle.rules,
    source: fixedSource,
  })
  signal?.throwIfAborted()
  const resources = new Map<string, ReturnType<typeof registerOwnedResource>>()
  let released = false
  const release = () => {
    if (released) return
    released = true
    signal?.removeEventListener('abort', release)
    for (const resource of resources.values()) resource.release()
    resources.clear()
  }
  try {
    const content = mapMedia(bundle.content, value => {
      const portable = portableMedia(value, assets)
      if (!portable.startsWith('arcadia-resource:')) return portable
      const id = portable.slice('arcadia-resource:'.length)
      if (!resources.has(id)) {
        const asset = assets.get(id)!
        resources.set(id, registerOwnedResource(new Blob([new Uint8Array(asset.bytes)], { type: asset.mime })))
      }
      return resources.get(id)!.url
    })
    signal?.addEventListener('abort', release, { once: true })
    signal?.throwIfAborted()
    return {
      bundle,
      reference,
      environment: bundle.environment,
      content,
      acceptance: {
        environmentId: reference.descriptor.id,
        protocolVersion: 1,
        resourceRevision: reference.descriptor.resourceRevision,
        peerRevision: bundle.environment.revision,
        resourcesReady: true,
      },
      release,
    }
  } catch (error) {
    release()
    throw error
  }
}

/** Check normalized online teams against this fixed recipe, without starting a VM or author factory. */
export function validatePersonalEnvironmentTeam(prepared: PreparedPersonalEnvironment, team: unknown): PetSchemaType[] {
  if (Array.isArray(team)) {
    for (const pet of team) {
      if (!record(pet)) invalid()
      for (const field of ['maxHp', 'currentHp', 'hp'])
        if (pet[field] !== undefined) throw new Error('个人挑战队伍不能覆盖生命值')
    }
  }
  const parsed = parseWithErrors(PlayerSchema, {
    id: 'personal-team-check01',
    name: 'team',
    team,
  }).team
  if (new Set(parsed.map(pet => pet.id)).size !== parsed.length) throw new Error('个人挑战队伍包含重复的精灵标识')
  const species = new Map(
    prepared.environment.data.species.map(raw => {
      const definition = parseWithErrors(SpeciesSchema, raw)
      return [definition.id, definition] as const
    }),
  )
  const skills = new Set(prepared.environment.data.skills.map(raw => (raw as { id: string }).id))
  const marks = new Set(prepared.environment.data.marks.map(raw => (raw as { id: string }).id))
  for (const pet of parsed) {
    const definition = species.get(pet.species)
    if (!definition || pet.level > 100 || Object.values(pet.evs).reduce((sum, value) => sum + value, 0) > 510)
      throw new Error('个人挑战队伍的精灵、等级或学习力不符合环境要求')
    for (const skill of pet.skills)
      if (
        !skills.has(skill) ||
        !definition.learnable_skills.some(entry => entry.skill_id === skill && entry.level <= pet.level)
      )
        throw new Error(`个人挑战队伍不能学习技能：${skill}`)
    if (pet.ability && (!marks.has(pet.ability) || !definition.ability.includes(pet.ability)))
      throw new Error(`个人挑战队伍不能使用特性：${pet.ability}`)
    if (pet.emblem && (!marks.has(pet.emblem) || !definition.emblem.includes(pet.emblem)))
      throw new Error(`个人挑战队伍不能使用纹章：${pet.emblem}`)
  }
  assertEnvironmentTeam(Value.Clone(prepared.reference.rules), parsed)
  return parsed
}

/** Explicit external acquisition; a room reference never triggers an automatic download. */
export async function downloadPersonalEnvironment(
  reference: PersonalEnvironmentReference,
  signal?: AbortSignal,
  request: typeof fetch = fetch,
): Promise<PreparedPersonalEnvironment> {
  signal?.throwIfAborted()
  const expected = await checkedReference(captureJson(reference))
  if (expected.source.kind !== 'https') invalid()
  const bytes = await readResourceBytes(
    expected.source.url,
    {
      signal,
      maxBytes: PERSONAL_ENVIRONMENT_DOWNLOAD_MAX_BYTES,
    },
    request,
  )
  const prepared = await parsePersonalEnvironmentBundle(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    expected.source,
    signal,
  )
  try {
    if ((await digestJson(prepared.reference)) !== (await digestJson(expected))) invalid()
    signal?.throwIfAborted()
    return prepared
  } catch (error) {
    prepared.release()
    throw error
  }
}
