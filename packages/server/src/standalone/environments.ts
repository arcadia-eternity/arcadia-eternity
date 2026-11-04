import { validateEnvironmentRules } from '@arcadia-eternity/content-dev/environment-rules'
import { presentationIndex } from '@arcadia-eternity/pack-loader/native'
import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { NativePackLoadResult } from '@arcadia-eternity/pack-loader/native'
import type { PreparedPresentation } from '@arcadia-eternity/pack-loader/node'
import { prepareNpmProject, readNpmAdmission } from '@arcadia-eternity/pack-loader/node'
import { officialTemplateDefinitions, officialEffectIds } from '@arcadia-eternity/data-pack-base/metadata'
import officialEffectArtifact from './effect-module'
import type { ServerEnvironmentContent, ServerEnvironmentDescriptor } from '@arcadia-eternity/protocol'
import { SkillSchema, MarkSchema, SpeciesSchema, parseWithErrors } from '@arcadia-eternity/schema'
import { createStandaloneRuntime, loadStandaloneBase, type StandaloneRuntime } from './native'

interface Environment {
  runtime: StandaloneRuntime
  descriptor: ServerEnvironmentDescriptor
  content: ServerEnvironmentContent
  assetFile(hash: string): string | undefined
  dispose(): Promise<void>
  retired: boolean
  references: number
  disposing?: Promise<void>
}
export type EnvironmentAdmissionRules = ReturnType<typeof validateEnvironmentRules>
export interface EnvironmentPublication {
  runtimeId: string
  bindingId?: string
  versionId?: string
  enabled: boolean
  public: boolean
  matchmaking: boolean
  executionPolicy?: 'server' | 'peer'
  rules?: EnvironmentAdmissionRules
}
export interface EnvironmentLease {
  readonly admissionKey?: string
  readonly runtime: StandaloneRuntime
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
  private readonly entries = new Map<string, Environment>()
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
      const base = await loadStandaloneBase()
      const runtime = createStandaloneRuntime(base)
      const id = digest(runtime.identity)
      const content = this.publicContent(runtime, base.data, base.presentation)
      content.locales = this.contentLocales([], base.locales, content)
      this.publish({
        runtime,
        descriptor: {
          id,
          protocolVersion: 1,
          runtime: runtime.identity,
          packages: [],
          resourceRevision: digest(content),
          resources: [],
        },
        content,
        assetFile: () => undefined,
        dispose: async () => {},
        references: 0,
        retired: false,
      })
      this.defaultId = id
      this.builtinId = id
    })().catch(error => {
      this.initializing = undefined
      throw error
    })
    await this.initializing
  }

  private publicContent(
    runtime: StandaloneRuntime,
    data: Parameters<typeof createStandaloneRuntime>[0]['data'],
    manifests: NativePackLoadResult['presentation'],
  ): ServerEnvironmentContent {
    const text = (raw: unknown) => {
      const record = raw as Record<string, unknown>
      return {
        ...(typeof record.name === 'string' ? { name: record.name } : {}),
        ...(typeof record.description === 'string' ? { description: record.description } : {}),
      }
    }
    const speciesText = new Map(
      data.species.map(raw => {
        const parsed = parseWithErrors(SpeciesSchema, raw)
        return [
          parsed.id,
          {
            ...text(raw),
            ...(parsed.presentation ? { presentation: parsed.presentation } : {}),
          },
        ] as const
      }),
    )
    const result: ServerEnvironmentContent = {
      species: [...runtime.species.values()].map(item => ({ ...structuredClone(item), ...speciesText.get(item.id) })),
      skills: data.skills.map(raw => {
        const { effect: _effect, ...display } = parseWithErrors(SkillSchema, raw)
        return { ...display, ...text(raw) }
      }),
      marks: data.marks.map(raw => {
        const mark = parseWithErrors(MarkSchema, raw)
        return {
          id: mark.id,
          tags: mark.tags ?? [],
          ...(mark.presentation ? { presentation: mark.presentation } : {}),
          ...text(raw),
        }
      }),
    }
    const presentations = presentationIndex(manifests)
    for (const kind of ['species', 'skills', 'marks'] as const)
      for (const row of result[kind]) {
        const presentation = presentations.get(`${kind}:${row.id}`)
        if (presentation) row.presentation = presentation
      }
    return result
  }

  private contentLocales(
    packages: PreparedPresentation[],
    official: NativePackLoadResult['locales'],
    content: ServerEnvironmentContent,
  ): NonNullable<ServerEnvironmentContent['locales']> {
    const bundles: NonNullable<ServerEnvironmentContent['locales']>['bundles'] = {}
    const allowed = new Set(['species', 'skill', 'mark', 'mark_ability', 'mark_emblem', 'mark_global'])
    const ids = {
      species: new Set(content.species.map(row => row.id)),
      skill: new Set(content.skills.map(row => row.id)),
      mark: new Set(content.marks.map(row => row.id)),
    }
    const add = (language: string, namespace: string, entries: unknown, prefix = '') => {
      if (!allowed.has(namespace)) throw new EnvironmentError('LOCALE_NAMESPACE_FORBIDDEN')
      if (!entries || typeof entries !== 'object' || Array.isArray(entries))
        throw new EnvironmentError('LOCALE_INVALID')
      const known = ids[namespace === 'species' ? 'species' : namespace === 'skill' ? 'skill' : 'mark']
      const target = ((bundles[language] ??= {})[namespace] ??= {})
      for (const [key, raw] of Object.entries(entries)) {
        const id = `${prefix}${key}`
        // Official bundles also contain records excluded from this runtime. Never export unrelated UI/local data.
        if (!known.has(id)) {
          if (prefix) throw new EnvironmentError('LOCALE_CONTENT_NOT_FOUND')
          continue
        }
        if (Object.hasOwn(target, id)) throw new EnvironmentError('LOCALE_CONFLICT')
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new EnvironmentError('LOCALE_INVALID')
        const fields: Record<string, string> = {}
        for (const [field, value] of Object.entries(raw)) {
          if (!['name', 'description'].includes(field)) {
            if (prefix) throw new EnvironmentError('LOCALE_FIELD_FORBIDDEN')
            continue
          }
          if (typeof value !== 'string' || value.length > 16_384) throw new EnvironmentError('LOCALE_INVALID')
          fields[field] = value
        }
        target[id] = fields
      }
    }
    for (const [language, namespaces] of Object.entries(official ?? {}))
      for (const [namespace, entries] of Object.entries(namespaces))
        if (allowed.has(namespace)) add(language, namespace, entries)
    for (const pkg of packages)
      for (const [language, namespaces] of Object.entries(pkg.manifest.locales))
        for (const [namespace, entries] of Object.entries(namespaces))
          add(language, namespace, entries, `${pkg.namespace}:`)
    return { defaultLocale: packages[0]?.manifest.defaultLocale ?? 'zh-CN', bundles }
  }

  private publish(environment: Environment) {
    if (this.closed) throw new EnvironmentError('SERVER_STOPPED')
    if (
      Buffer.byteLength(JSON.stringify(environment.content)) > 16 * 1024 * 1024 ||
      Buffer.byteLength(JSON.stringify(environment.descriptor)) > 16 * 1024 * 1024
    )
      throw new EnvironmentError('PUBLIC_CATALOG_TOO_LARGE')
    this.entries.set(environment.descriptor.id, environment)
  }

  /** Fixed empty npm environments still get distinct room identities and rule snapshots. */
  async prepareBuiltin(): Promise<ServerEnvironmentDescriptor> {
    await this.ready()
    const builtin = this.entry(this.builtinId)
    const descriptor = {
      ...structuredClone(builtin.descriptor),
      id: digest({ builtin: this.builtinId, instance: randomUUID() }),
    }
    this.publish({
      ...builtin,
      descriptor,
      content: structuredClone(builtin.content),
      references: 0,
      retired: false,
      dispose: async () => {},
    })
    return this.descriptor(descriptor.id)
  }

  async prepareNpm(
    directory: string,
    approvalFile: string | Awaited<ReturnType<typeof readNpmAdmission>> = resolve(directory, 'arcadia-admission.json'),
    preparation: { effectPreparation?: 'compile' | 'prebuilt-only' } = {},
  ): Promise<ServerEnvironmentDescriptor> {
    await this.ready()
    const base = await loadStandaloneBase()
    const prepared = await prepareNpmProject(
      directory,
      {
        build: base.build,
        base: base.data,
        templates: officialTemplateDefinitions,
        effectIds: officialEffectIds,
        effectModules: [{ artifact: officialEffectArtifact, namespace: '', role: 'catalog' }],
      },
      typeof approvalFile === 'string' ? await readNpmAdmission(approvalFile) : approvalFile,
      preparation,
    )
    try {
      const runtime = createStandaloneRuntime(prepared)
      // Local code edits do not change the metadata identity. Every preparation is
      // a fresh room-selectable instance, so it cannot silently reuse an older runtime.
      const id = digest({ runtime: runtime.identity, instance: randomUUID() })
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
      const content = this.publicContent(runtime, prepared.data, base.presentation)
      for (const pkg of prepared.presentation)
        for (const binding of pkg.manifest.bindings) {
          const { id: _id, target, ...presentation } = binding
          const owner = content[target.kind].find(row => row.id === `${pkg.namespace}:${target.id}`)
          if (!owner) throw new EnvironmentError('PRESENTATION_TARGET')
          owner.presentation = presentation
        }
      content.locales = this.contentLocales(prepared.presentation, base.locales, content)
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
        packages: prepared.installation.packages
          .filter(pkg => pkg.manifest)
          .map(pkg => ({
            name: pkg.name,
            version: pkg.version,
            projectId: pkg.manifest!.projectId,
            namespace: pkg.manifest!.namespace,
          })),
      }
      this.publish({
        runtime,
        descriptor,
        content,
        assetFile: hash => files.get(hash) ?? prepared.assetFile(hash),
        dispose: prepared.dispose,
        references: 0,
        retired: false,
      })
      return this.descriptor(descriptor.id)
    } catch (error) {
      await prepared.dispose()
      throw error
    }
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
      .map(entry => this.publicDescriptor(entry))
  }
  private publicDescriptor(entry: Environment): ServerEnvironmentDescriptor {
    const descriptor = structuredClone(entry.descriptor)
    const policy = this.publication?.get(entry.descriptor.id)?.executionPolicy
    return {
      ...descriptor,
      ...(policy ? { executionPolicy: policy } : {}),
      ...(entry.runtime.sandbox ? { peerRevision: entry.runtime.sandbox.revision } : {}),
    }
  }
  /** Captured static material only. No imports, factories or VM are evaluated by delivery. */
  peerMaterials(id: string) {
    const entry = this.entry(id)
    if (!entry.runtime.sandbox || (entry.descriptor.packages.length && !this.peerMaterialIds.has(id)))
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
  private entry(id = this.defaultId): Environment {
    const entry = id && this.entries.get(id)
    if (!entry) throw new EnvironmentError('ENVIRONMENT_NOT_FOUND')
    return entry
  }
  descriptor(id?: string): ServerEnvironmentDescriptor {
    return this.publicDescriptor(this.entry(id))
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
    return structuredClone(this.entry(id).content)
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
      admissionKey: digest({
        runtimeId: entry.descriptor.id,
        bindingId: publication?.bindingId,
        versionId: publication?.versionId,
        rules: publication?.rules,
        executionPolicy: publication?.executionPolicy,
      }),
      descriptor: this.publicDescriptor(entry),
      isNpm: entry.descriptor.packages.length > 0,
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
  private async collect(entry: Environment) {
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
