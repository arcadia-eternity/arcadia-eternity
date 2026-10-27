import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { prepareNpmProject, readNpmAdmission } from '@arcadia-eternity/pack-loader/node'
import { createOfficialContent, officialTemplateDefinitions } from '@arcadia-eternity/data-pack-base/native'
import type { ServerEnvironmentContent, ServerEnvironmentDescriptor } from '@arcadia-eternity/protocol'
import { SkillSchema, MarkSchema, parseWithErrors } from '@arcadia-eternity/schema'
import { createStandaloneRuntime, loadStandaloneBase, type StandaloneRuntime } from './native'

interface Environment {
  runtime: StandaloneRuntime
  descriptor: ServerEnvironmentDescriptor
  content: ServerEnvironmentContent
  readAsset(hash: string): Uint8Array | undefined
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
  private closed = false

  async ready(): Promise<void> {
    if (this.closed) throw new EnvironmentError('SERVER_STOPPED')
    this.initializing ??= (async () => {
      const base = await loadStandaloneBase()
      const runtime = createStandaloneRuntime(base)
      const id = digest(runtime.identity)
      this.publish({
        runtime,
        descriptor: {
          id,
          protocolVersion: 1,
          runtime: runtime.identity,
          packages: [],
          resourceRevision: digest([]),
          resources: [],
        },
        content: this.publicContent(runtime, base.data),
        readAsset: () => undefined,
        dispose: async () => {},
        references: 0,
        retired: false,
      })
      this.defaultId = id
    })().catch(error => {
      this.initializing = undefined
      throw error
    })
    await this.initializing
  }

  private publicContent(
    runtime: StandaloneRuntime,
    data: Parameters<typeof createStandaloneRuntime>[0]['data'],
  ): ServerEnvironmentContent {
    return {
      species: [...runtime.species.values()].map(item => structuredClone(item)),
      skills: data.skills.map(raw => {
        const { effect: _effect, ...display } = parseWithErrors(SkillSchema, raw)
        return display
      }),
      marks: data.marks.map(raw => {
        const mark = parseWithErrors(MarkSchema, raw)
        return { id: mark.id, ...(mark.iconRef ? { iconRef: mark.iconRef } : {}), tags: mark.tags ?? [] }
      }),
    }
  }

  private publish(environment: Environment) {
    if (this.closed) throw new EnvironmentError('SERVER_STOPPED')
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
      const id = digest(runtime.identity)
      const existing = this.entries.get(id)
      if (existing) {
        if (existing.retired) throw new EnvironmentError('ENVIRONMENT_RETIRED')
        await prepared.dispose()
        return structuredClone(existing.descriptor)
      }
      const resources = prepared.releases.flatMap(release =>
        release.assets.map(asset => ({
          ...asset,
          projectId: release.project.id,
          url: `/api/v1/environments/${id}/assets/${asset.sha256}`,
        })),
      )
      const descriptor: ServerEnvironmentDescriptor = {
        id,
        protocolVersion: 1,
        runtime: runtime.identity,
        resources,
        resourceRevision: digest(resources),
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
        content: this.publicContent(runtime, prepared.data),
        readAsset: prepared.readAsset,
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
  content(id: string): ServerEnvironmentContent {
    return structuredClone(this.entry(id).content)
  }
  asset(id: string, hash: string) {
    const entry = this.entry(id)
    const asset = entry.descriptor.resources.find(asset => asset.sha256 === hash)
    const bytes = asset && entry.readAsset(hash)
    if (!asset || !bytes) throw new EnvironmentError('RESOURCE_NOT_FOUND')
    return { mime: asset.mime, bytes }
  }

  /** Keep a lease for every room or retained checkpoint; retiring never destroys a referenced environment. */
  acquire(id?: string): EnvironmentLease {
    if (this.closed) throw new EnvironmentError('SERVER_STOPPED')
    const entry = this.entry(id)
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
    if (id === this.defaultId) throw new EnvironmentError('DEFAULT_ENVIRONMENT_REQUIRED')
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
