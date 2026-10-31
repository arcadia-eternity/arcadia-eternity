import { presentationIndex } from '@arcadia-eternity/pack-loader/native'
import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { NativePackLoadResult } from '@arcadia-eternity/pack-loader/native'
import type { PreparedPresentation } from '@arcadia-eternity/pack-loader/node'
import { prepareNpmProject, readNpmAdmission } from '@arcadia-eternity/pack-loader/node'
import { createOfficialContent, officialTemplateDefinitions } from '@arcadia-eternity/data-pack-base/native'
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
}
export interface EnvironmentLease {
  readonly runtime: StandaloneRuntime
  readonly descriptor: ServerEnvironmentDescriptor
  readonly isNpm: boolean
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
  private initializing?: Promise<void>
  private defaultId?: string
  private builtinId?: string
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

  async prepareNpm(
    directory: string,
    approvalFile = resolve(directory, 'arcadia-admission.json'),
  ): Promise<ServerEnvironmentDescriptor> {
    await this.ready()
    const base = await loadStandaloneBase()
    const prepared = await prepareNpmProject(
      directory,
      {
        build: base.build,
        base: base.data,
        templates: officialTemplateDefinitions,
        createContent: createOfficialContent,
      },
      await readNpmAdmission(approvalFile),
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
      return structuredClone(descriptor)
    } catch (error) {
      await prepared.dispose()
      throw error
    }
  }

  list(): ServerEnvironmentDescriptor[] {
    return [...this.entries.values()].filter(entry => !entry.retired).map(entry => structuredClone(entry.descriptor))
  }
  private entry(id = this.defaultId): Environment {
    const entry = id && this.entries.get(id)
    if (!entry) throw new EnvironmentError('ENVIRONMENT_NOT_FOUND')
    return entry
  }
  descriptor(id?: string): ServerEnvironmentDescriptor {
    return structuredClone(this.entry(id).descriptor)
  }
  /** Host-only selection for future rooms. Existing room leases keep their original runtime. */
  selectDefault(id: string): ServerEnvironmentDescriptor {
    if (this.closed) throw new EnvironmentError('SERVER_STOPPED')
    const entry = this.entry(id)
    if (entry.retired) throw new EnvironmentError('ENVIRONMENT_RETIRED')
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
  acquire(id?: string, builtinOnly = false): EnvironmentLease {
    if (this.closed) throw new EnvironmentError('SERVER_STOPPED')
    const entry = this.entry(id ?? (builtinOnly ? this.builtinId : undefined))
    if (entry.retired) throw new EnvironmentError('ENVIRONMENT_RETIRED')
    entry.references++
    let released = false
    return {
      runtime: entry.runtime,
      descriptor: structuredClone(entry.descriptor),
      isNpm: entry.descriptor.packages.length > 0,
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
    this.entries.delete(entry.descriptor.id)
    await entry.dispose()
  }
  async stop(): Promise<void> {
    this.closed = true
    for (const entry of this.entries.values()) entry.retired = true
    await Promise.all([...this.entries.values()].map(entry => this.collect(entry)))
  }
}
