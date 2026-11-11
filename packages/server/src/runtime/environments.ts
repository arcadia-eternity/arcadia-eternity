import { validateEnvironmentRules } from '@arcadia-eternity/content-sdk/environment-rules'
import { buildDisplayCatalog, buildDisplayLocales } from '@arcadia-eternity/pack-loader/native'
import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import {
  emptyNpmContentHost,
  prepareNpmProject,
  readNpmAdmission,
  type PreparedNpmEnvironment,
} from '@arcadia-eternity/pack-loader/node'
import type { ServerEnvironmentContent, ServerEnvironmentDescriptor } from '@arcadia-eternity/protocol'
import { createServerRuntime, loadServerBase, type ServerRuntime } from './native'

interface Environment {
  runtime: ServerRuntime
  descriptor: ServerEnvironmentDescriptor
  content: ServerEnvironmentContent
  thirdParty?: boolean
  bundled?: boolean
  assetFile(hash: string): string | undefined
  dispose(): Promise<void>
  retired: boolean
  references: number
  disposing?: Promise<void>
}
type PublishedEnvironment = Omit<Environment, 'content'> & { catalogJson: string }
export type EnvironmentAdmissionRules = ReturnType<typeof validateEnvironmentRules>
export interface EnvironmentPublication {
  runtimeId: string
  environmentId?: string
  environmentName?: string
  bindingId?: string
  versionId?: string
  enabled: boolean
  public: boolean
  matchmaking: boolean
  executionPolicy?: 'server' | 'peer'
  rules?: EnvironmentAdmissionRules
}
export interface EnvironmentLease {
  readonly environmentId?: string
  readonly environmentName?: string
  readonly bindingId?: string
  readonly versionId?: string
  readonly admissionKey?: string
  readonly runtime: ServerRuntime
  readonly descriptor: ServerEnvironmentDescriptor
  readonly isNpm: boolean
  readonly executionPolicy?: 'server' | 'peer'
  readonly rules?: EnvironmentAdmissionRules
  release(): Promise<void>
}
export class EnvironmentError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Local administrator API. Public HTTP/socket clients can only select prepared entries. */
export class ServerEnvironmentRegistry {
  private readonly entries = new Map<string, PublishedEnvironment>()
  private readonly disposingIds = new Set<string>()
  private initializing?: Promise<void>
  private defaultId?: string
  private builtinId?: string
  private publication?: Map<string, EnvironmentPublication>
  private readonly peerMaterialIds = new Set<string>()
  private closed = false
  async ready(): Promise<void> {
    if (this.closed) throw new EnvironmentError('SERVER_STOPPED')
    this.initializing ??= (async () => {
      const base = await loadServerBase()
      const runtime = createServerRuntime(base)
      const id = digest(runtime.identity)
      // The shipped prepared environment is shared by registries in this process.
      this.publishPrepared(base, runtime, id, { bundled: true, thirdParty: false, dispose: async () => {} })
      this.defaultId ??= id
      this.builtinId = id
    })().catch(error => {
      this.initializing = undefined
      throw error
    })
    await this.initializing
  }

  private publish(environment: Environment) {
    if (this.closed) throw new EnvironmentError('SERVER_STOPPED')
    const { content, ...entry } = environment
    const catalogJson = JSON.stringify(content)
    if (
      Buffer.byteLength(catalogJson) > 16 * 1024 * 1024 ||
      Buffer.byteLength(JSON.stringify(environment.descriptor)) > 16 * 1024 * 1024
    )
      throw new EnvironmentError('PUBLIC_CATALOG_TOO_LARGE')
    this.entries.set(entry.descriptor.id, { ...entry, catalogJson })
  }

  async prepareNpm(
    directory: string,
    approvalFile: string | Awaited<ReturnType<typeof readNpmAdmission>> = resolve(directory, 'arcadia-admission.json'),
    preparation: { effectPreparation?: 'compile' | 'prebuilt-only' } = {},
  ): Promise<ServerEnvironmentDescriptor> {
    if (this.closed) throw new EnvironmentError('SERVER_STOPPED')
    const approval = typeof approvalFile === 'string' ? await readNpmAdmission(approvalFile) : approvalFile
    const prepared = await prepareNpmProject(directory, emptyNpmContentHost, approval, preparation)
    try {
      const thirdParty = prepared.installation.packages.some(pkg => pkg.manifest)
      let bundled = false
      if (prepared.installation.packages.some(pkg => pkg.officialHost)) {
        const shipped = await loadServerBase()
        const catalog = prepared.sandbox.modules.find(module => module.role === 'catalog')
        // officialHost comes from package metadata, so a package name is not a trust
        // boundary. Only the shipped official artifact may run under official policy.
        const sameCode = catalog && digest(catalog.artifact) === digest(shipped.sandbox.modules[0].artifact)
        if (!sameCode && approval.policy.profile === 'official')
          throw new EnvironmentError('THIRD_PARTY_EXECUTION_FORBIDDEN')
        bundled = Boolean(
          sameCode &&
          !thirdParty &&
          (['species', 'skills', 'marks'] as const).every(
            kind => digest(prepared.data[kind]) === digest(shipped.data[kind]),
          ),
        )
      }
      const runtime = createServerRuntime(prepared)
      // Local code edits do not change the metadata identity. Every preparation is
      // a fresh room-selectable instance, so it cannot silently reuse an older runtime.
      const id = digest({ runtime: runtime.identity, instance: randomUUID() })
      this.publishPrepared(prepared, runtime, id, { bundled, thirdParty, dispose: prepared.dispose })
      return { ...this.descriptor(id), peerRevision: prepared.sandbox.revision }
    } catch (error) {
      await prepared.dispose()
      throw error
    }
  }

  private publishPrepared(
    prepared: Readonly<PreparedNpmEnvironment>,
    runtime: ServerRuntime,
    id: string,
    options: Pick<Environment, 'bundled' | 'thirdParty' | 'dispose'>,
  ) {
    const legacyResources = prepared.releases.flatMap(release =>
      release.assets.map(asset => ({
        ...asset,
        projectId: release.project.id,
        url: `/api/v1/environments/${id}/assets/${asset.sha256}`,
      })),
    )
    const resources = [
      ...legacyResources,
      ...prepared.presentation.flatMap(pkg =>
        pkg.resources.map(asset => ({
          id: asset.id,
          variant: 'default',
          projectId: pkg.projectId,
          sha256: asset.sha256,
          bytes: asset.bytes,
          mime: asset.mime,
          url: `/api/v1/environments/${id}/assets/${asset.sha256}`,
        })),
      ),
    ]
    const files = new Map(
      prepared.presentation.flatMap(pkg => pkg.resources.map(asset => [asset.sha256, asset.file] as const)),
    )
    const content: ServerEnvironmentContent = buildDisplayCatalog(prepared.data, [], prepared.presentation)
    content.locales = buildDisplayLocales(prepared.presentation, {}, content)
    const descriptor: ServerEnvironmentDescriptor = {
      id,
      protocolVersion: 1,
      runtime: runtime.identity,
      resources,
      remoteResources: prepared.presentation.flatMap(pkg =>
        pkg.manifest.resources
          .filter(asset => asset.kind === 'http')
          .map(asset => ({
            projectId: pkg.projectId,
            id: asset.id,
            url: asset.source,
            ...(asset.mime ? { mime: asset.mime } : {}),
          })),
      ),
      resourceRevision: digest({ content, resources, presentation: prepared.presentation.map(pkg => pkg.manifest) }),
      packages: prepared.installation.members.map(({ name, version, projectId, namespace }) => ({
        name,
        version,
        projectId,
        namespace,
      })),
    }
    this.publish({
      runtime,
      descriptor,
      content,
      ...options,
      assetFile: hash => files.get(hash) ?? prepared.assetFile(hash),
      references: 0,
      retired: false,
    })
  }

  /** Private host lifecycle inspection, including retired entries still held by leases. */
  retainedIds(): string[] {
    return [...new Set([...this.entries.keys(), ...this.disposingIds])]
  }
  /** Atomically replace admission policy; removing publication never invalidates existing leases. */
  setPublication(entries: readonly EnvironmentPublication[], defaultRuntimeId?: string): void {
    if (this.closed) throw new EnvironmentError('SERVER_STOPPED')
    const next = new Map<string, EnvironmentPublication>()
    for (const publication of entries) {
      const entry = this.entry(publication.runtimeId)
      if (entry.retired) throw new EnvironmentError('ENVIRONMENT_RETIRED')
      let rules: EnvironmentAdmissionRules
      try {
        rules = validateEnvironmentRules(publication.rules)
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
        throw new EnvironmentError(code === 'ENVIRONMENT_RULES_UNSUPPORTED' ? code : 'ENVIRONMENT_RULES_INVALID')
      }
      const executionPolicy = publication.executionPolicy ?? 'server'
      if (executionPolicy !== 'server' && executionPolicy !== 'peer')
        throw new EnvironmentError('ENVIRONMENT_EXECUTION_POLICY_INVALID')
      const previous = next.get(publication.runtimeId)
      if (previous && previous.executionPolicy !== executionPolicy)
        throw new EnvironmentError('ENVIRONMENT_EXECUTION_POLICY_CONFLICT')
      if (previous && JSON.stringify(previous.rules) !== JSON.stringify(rules))
        throw new EnvironmentError('ENVIRONMENT_RULES_CONFLICT')
      next.set(publication.runtimeId, {
        ...structuredClone(publication),
        executionPolicy,
        rules,
        enabled: publication.enabled || previous?.enabled || false,
        public: (publication.enabled && publication.public) || previous?.public || false,
        matchmaking: (publication.enabled && publication.matchmaking) || previous?.matchmaking || false,
      })
    }
    if (defaultRuntimeId !== undefined && !next.get(defaultRuntimeId)?.enabled)
      throw new EnvironmentError('DEFAULT_ENVIRONMENT_REQUIRED')
    this.publication = next
    for (const publication of next.values())
      if (publication.executionPolicy === 'peer') this.peerMaterialIds.add(publication.runtimeId)
    this.defaultId = defaultRuntimeId ?? this.builtinId
  }
  list(): ServerEnvironmentDescriptor[] {
    return [...this.entries.values()]
      .filter(
        entry =>
          !entry.retired &&
          (!this.publication ||
            (this.publication.get(entry.descriptor.id)?.enabled && this.publication.get(entry.descriptor.id)?.public)),
      )
      .map(entry => ({
        ...this.publicDescriptor(entry),
        ...(entry.descriptor.id === this.defaultId && { isDefault: true }),
      }))
  }
  private publicDescriptor(entry: PublishedEnvironment): ServerEnvironmentDescriptor {
    const descriptor = structuredClone(entry.descriptor)
    const policy = this.publication?.get(entry.descriptor.id)?.executionPolicy
    const peerRevision = (entry.bundled || this.peerMaterialIds.has(descriptor.id)) && entry.runtime.sandbox?.revision
    return {
      ...descriptor,
      ...(policy ? { executionPolicy: policy } : {}),
      ...(peerRevision ? { peerRevision } : {}),
    }
  }
  /** Captured static material only. No imports, factories or VM are evaluated by delivery. */
  peerMaterials(id: string) {
    const entry = this.entry(id)
    if (!entry.runtime.sandbox || (!entry.bundled && !this.peerMaterialIds.has(id)))
      throw new EnvironmentError('ENVIRONMENT_PEER_MATERIALS_UNAVAILABLE')
    const descriptor = this.publicDescriptor(entry)
    const captured = entry.runtime.sandbox
    const payload = structuredClone({
      protocolVersion: 1 as const,
      environmentId: id,
      resourceRevision: descriptor.resourceRevision,
      runtime: descriptor.runtime,
      packages: descriptor.packages,
      environment: { revision: captured.revision, data: captured.data, modules: captured.modules },
    })
    if (Buffer.byteLength(JSON.stringify(payload)) > 64 * 1024 * 1024)
      throw new EnvironmentError('ENVIRONMENT_PEER_MATERIALS_TOO_LARGE')
    return payload
  }
  private entry(id = this.defaultId): PublishedEnvironment {
    const entry = id && this.entries.get(id)
    if (!entry) throw new EnvironmentError('ENVIRONMENT_NOT_FOUND')
    return entry
  }
  descriptor(id?: string): ServerEnvironmentDescriptor {
    return this.publicDescriptor(this.entry(id))
  }
  hasThirdPartyPackages(id: string): boolean {
    return this.entry(id).thirdParty === true
  }
  /** Host-only selection for future rooms. Existing room leases keep their original runtime. */
  selectDefault(id: string): ServerEnvironmentDescriptor {
    if (this.closed) throw new EnvironmentError('SERVER_STOPPED')
    const entry = this.entry(id)
    if (entry.retired) throw new EnvironmentError('ENVIRONMENT_RETIRED')
    if (this.publication && !this.publication.get(id)?.enabled) throw new EnvironmentError('ENVIRONMENT_NOT_PUBLISHED')
    const previous = this.descriptor()
    this.defaultId = id
    return previous
  }
  content(id: string): ServerEnvironmentContent {
    return JSON.parse(this.contentJson(id)) as ServerEnvironmentContent
  }
  contentJson(id: string): string {
    return this.entry(id).catalogJson
  }
  asset(id: string, hash: string) {
    const entry = this.entry(id)
    const asset = entry.descriptor.resources.find(asset => asset.sha256 === hash)
    const file = asset && entry.assetFile(hash)
    if (!asset || !file) throw new EnvironmentError('RESOURCE_NOT_FOUND')
    entry.references++
    let released = false
    return {
      mime: asset.mime,
      file,
      bytes: asset.bytes,
      sha256: asset.sha256,
      release: async () => {
        if (released) return
        released = true
        entry.references--
        await this.collect(entry)
      },
    }
  }

  /** Keep a lease for every room or retained checkpoint; retiring never destroys a referenced environment. */
  acquire(id?: string, builtinOnly = false, purpose: 'room' | 'matchmaking' = 'room'): EnvironmentLease {
    if (this.closed) throw new EnvironmentError('SERVER_STOPPED')
    const entry = this.entry(id ?? (builtinOnly && !this.publication ? this.builtinId : undefined))
    if (entry.retired) throw new EnvironmentError('ENVIRONMENT_RETIRED')
    const publication = this.publication?.get(entry.descriptor.id)
    if (this.publication && !publication?.enabled) throw new EnvironmentError('ENVIRONMENT_NOT_PUBLISHED')
    if (this.publication && purpose === 'matchmaking' && !publication?.matchmaking)
      throw new EnvironmentError('ENVIRONMENT_MATCHMAKING_DISABLED')
    entry.references++
    let released = false
    return {
      runtime: entry.runtime,
      bindingId: publication?.bindingId,
      versionId: publication?.versionId,
      environmentId: publication?.environmentId,
      environmentName: publication?.environmentName,
      admissionKey: digest({
        runtimeId: entry.descriptor.id,
        bindingId: publication?.bindingId,
        versionId: publication?.versionId,
        rules: publication?.rules,
        executionPolicy: publication?.executionPolicy,
      }),
      descriptor: this.publicDescriptor(entry),
      isNpm: !entry.bundled,
      ...(publication ? { executionPolicy: publication.executionPolicy ?? 'server' } : {}),
      ...(publication?.rules ? { rules: structuredClone(publication.rules) } : {}),
      release: async () => {
        if (released) return
        released = true
        entry.references--
        await this.collect(entry)
      },
    }
  }
  async retire(id: string): Promise<void> {
    const entry = this.entry(id)
    if (id === this.defaultId || id === this.builtinId) throw new EnvironmentError('DEFAULT_ENVIRONMENT_REQUIRED')
    entry.retired = true
    await this.collect(entry)
  }
  private async collect(entry: PublishedEnvironment) {
    if (!entry.retired || entry.references) return
    const id = entry.descriptor.id
    this.disposingIds.add(id)
    this.entries.delete(id)
    this.peerMaterialIds.delete(id)
    entry.disposing ??= entry.dispose()
    await entry.disposing
    this.disposingIds.delete(id)
  }
  async stop(): Promise<void> {
    this.closed = true
    for (const entry of this.entries.values()) entry.retired = true
    await Promise.all([...this.entries.values()].map(entry => this.collect(entry)))
  }
}
