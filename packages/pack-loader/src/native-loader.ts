import {
  type EnvironmentBuildIdentity,
  type ContentCatalog,
  type ContentPrototypeData,
} from '@arcadia-eternity/battle/v4'
import type { PackManifest } from '@arcadia-eternity/schema'
import YAML from 'yaml'
import { PackTransport, type AssetLoadRecord } from './transport'
import type { PackLoadResult, PackLoaderOptions, PackSource, LocaleBundles } from './types'

export type NativeContentFactory = (data: ContentPrototypeData, revision: string) => ContentCatalog

export interface NativePackLoaderOptions {
  source?: PackSource
  enforceLockfile?: boolean
  expectedRevision?: string
}
export interface NativeContentResult {
  runtime: 'native-v4'
  content: ContentCatalog
  revision: string
  packs: { id: string; version: string }[]
  build: EnvironmentBuildIdentity
}
export interface NativePackMetadataResult extends Omit<PackLoadResult, 'repository'> {
  data: ContentPrototypeData
}
export interface NativePackLoadResult extends NativePackMetadataResult, NativeContentResult {}
interface MetadataPack {
  manifest: PackManifest
  source: string
  raw: string
  readData(file: string): Promise<unknown[]>
  readLocale(file: string): Promise<unknown>
  assets: AssetLoadRecord[]
}

/** Load transport metadata against the trusted host's compiled effect directory. */
export class NativePackLoader extends PackTransport {
  private readonly build: EnvironmentBuildIdentity
  constructor(
    build: EnvironmentBuildIdentity,
    private readonly contentFactory: NativeContentFactory,
  ) {
    super()
    if (
      build.formatVersion !== 1 ||
      !/^[a-f0-9]{64}$/.test(build.coreBuildId) ||
      !/^[a-f0-9]{64}$/.test(build.registryBuildId)
    )
      throw new Error('Invalid trusted native build identity')
    if (typeof contentFactory !== 'function') throw new Error('A trusted native content factory is required')
    this.build = Object.freeze({
      formatVersion: 1,
      coreBuildId: build.coreBuildId,
      registryBuildId: build.registryBuildId,
    })
  }

  /** Use the caller's current metadata, including unsaved editor changes, with the same trusted code identity. */
  async fromMetadata(
    data: ContentPrototypeData,
    options: { packs?: { id: string; version: string }[]; expectedRevision?: string } = {},
  ): Promise<NativeContentResult> {
    return this.createContent(data, options.packs ?? [], options.expectedRevision)
  }

  private async createContent(
    data: ContentPrototypeData,
    packs: { id: string; version: string }[],
    expectedRevision?: string,
  ): Promise<NativeContentResult> {
    const captured = structuredClone(data)
    const revision = `arcadia.native-content/1:${await this.computeIntegrity(JSON.stringify({ build: this.build, packs, data: captured }))}`
    if (expectedRevision !== undefined && revision !== expectedRevision)
      throw new Error('Native content revision mismatch')
    return {
      runtime: 'native-v4',
      packs: structuredClone(packs),
      content: this.contentFactory(captured, revision),
      revision,
      build: this.build,
    }
  }

  async load(packRef = 'builtin:base', options: NativePackLoaderOptions = {}): Promise<NativePackLoadResult> {
    const expectedRevision = options.expectedRevision
    const { metadata, identities } = await this.loadMetadataBatch(packRef, options)
    // Source URLs and presentation assets do not change executable content identity.
    // Metadata order and its JSON representation are part of this versioned contract.
    const authority = await this.createContent(metadata.data, identities, expectedRevision)
    return { ...metadata, ...authority }
  }

  /** Read editable data before composing layers; linking and trusted behavior validation happen in load/fromMetadata. */
  async loadMetadata(
    packRef = 'builtin:base',
    options: Pick<NativePackLoaderOptions, 'source' | 'enforceLockfile'> = {},
  ): Promise<NativePackMetadataResult> {
    return (await this.loadMetadataBatch(packRef, options)).metadata
  }

  private async loadMetadataBatch(
    packRef: string,
    options: Pick<NativePackLoaderOptions, 'source' | 'enforceLockfile'>,
  ) {
    const source = options.source ?? 'node-fs'
    const transportOptions: PackLoaderOptions = { enforceLockfile: options.enforceLockfile, continueOnError: false }
    const errors: string[] = []
    const batch =
      source === 'node-fs'
        ? await this.loadNodeMetadata(packRef, transportOptions, errors)
        : source === 'http'
          ? await this.loadHttpMetadata(packRef, transportOptions, errors)
          : undefined
    if (!batch) throw new Error(`Unsupported native pack source: ${source}`)
    const { packs, lockfile } = batch

    const entry = packs[packs.length - 1]
    if (!entry) throw new Error('Native content requires an entry pack')
    if (transportOptions.enforceLockfile && !lockfile) throw new Error('Native pack lockfile is required')
    const lockfileIssues = await this.validateLockfile(lockfile, {
      pack: entry.manifest,
      packSource: entry.source,
      packRaw: entry.raw,
      assets: entry.assets,
    })
    this.assertLockfileIssues(lockfileIssues, transportOptions)
    const { data, locales } = await this.readMetadata(packs)
    const assets = packs.flatMap(pack => pack.assets)
    const metadata: NativePackMetadataResult = {
      data,
      errors,
      pack: entry.manifest,
      packRef,
      source,
      lockfile,
      lockfileIssues,
      locales,
      assets: assets.map(asset => asset.manifest),
      assetConflicts: this.detectAssetConflicts(assets),
    }
    return {
      metadata,
      identities: packs.map(pack => ({ id: pack.manifest.id, version: pack.manifest.version })),
    }
  }
  private async loadNodeMetadata(packRef: string, transportOptions: PackLoaderOptions, errors: string[]) {
    const resolver = await this.importNodePackResolver()
    const entries = await resolver.resolvePackEntriesFromRef(packRef)
    const order = new Map<string, Awaited<ReturnType<typeof resolver.resolvePackLoadOrder>>['order'][number]>()
    const identities = new Map<string, string>()
    for (const entryPath of entries) {
      const resolved = await resolver.resolvePackLoadOrder(entryPath, false, errors)
      for (const item of resolved.order) {
        const previous = identities.get(item.manifest.id)
        if (previous && previous !== item.path) throw new Error(`Duplicate native pack identity: ${item.manifest.id}`)
        identities.set(item.manifest.id, item.path)
        order.set(item.path, item)
      }
    }
    const { resolve } = await import('node:path')
    const packs: MetadataPack[] = []
    let lockfile: Awaited<ReturnType<typeof this.loadLockfileFromNodeFs>>
    for (const item of order.values()) {
      const assets = await this.loadAssetsFromNodeFs(item.path, item.manifest, transportOptions, errors)
      lockfile = await this.loadLockfileFromNodeFs(item.path, transportOptions)
      if (transportOptions.enforceLockfile && !lockfile)
        throw new Error(`Native pack lockfile is required: ${item.path}`)
      this.assertLockfileIssues(
        await this.validateLockfile(lockfile, {
          pack: item.manifest,
          packSource: item.path,
          packRaw: await this.readNodeText(item.path),
          assets,
        }),
        transportOptions,
      )
      packs.push({
        manifest: item.manifest,
        source: item.path,
        raw: await this.readNodeText(item.path),
        readData: async file => {
          const path = resolve(item.dataRoot, file)
          const parsed: unknown = YAML.parse(await this.readNodeText(path), { merge: true })
          if (!Array.isArray(parsed)) throw new Error(`Expected array content from ${path}`)
          return parsed
        },
        readLocale: async file => YAML.parse(await this.readNodeText(resolve(item.localesRoot, file)), { merge: true }),
        assets,
      })
    }
    return { packs, lockfile }
  }

  private async loadHttpMetadata(packRef: string, transportOptions: PackLoaderOptions, errors: string[]) {
    const resolved = await this.resolveHttpPackLoadOrder(
      this.toAbsoluteHttpUrl(this.resolveManifestUrl(packRef)),
      transportOptions,
      errors,
    )
    const packs: MetadataPack[] = []
    for (const item of resolved.order) {
      const localesRoot = this.resolveDirectoryUrl(item.manifest.paths?.localesDir ?? 'locales', item.manifestUrl)
      packs.push({
        manifest: item.manifest,
        source: item.manifestUrl,
        raw: item.manifestRaw,
        readData: file => this.fetchArray(new URL(file, item.dataRoot).toString()),
        readLocale: file => this.fetchObject(new URL(file, localesRoot).toString()),
        assets: (await this.loadAssetsFromManifest(item.manifest, item.manifestUrl, transportOptions, errors)).records,
      })
    }
    const lockfile = await this.loadLockfileFromHttp(resolved.entry.manifestUrl, transportOptions, errors)
    return { packs, lockfile }
  }

  private async readMetadata(packs: readonly MetadataPack[]) {
    const data = { marks: [] as unknown[], skills: [] as unknown[], species: [] as unknown[] }
    const locales: LocaleBundles = {}
    for (const pack of packs) {
      if (!pack.manifest.id || !pack.manifest.version || pack.manifest.engine !== 'seer2-v2' || !pack.manifest.data)
        throw new Error(`Invalid native metadata manifest: ${pack.source}`)
      for (const kind of ['marks', 'skills', 'species'] as const)
        if (
          !Array.isArray(pack.manifest.data[kind]) ||
          !pack.manifest.data[kind].every(file => typeof file === 'string' && file.length > 0)
        )
          throw new Error(`Invalid native metadata file list: ${kind}`)
        else for (const file of pack.manifest.data[kind]) data[kind].push(...(await pack.readData(file)))
      const entries = Array.isArray(pack.manifest.locales)
        ? pack.manifest.locales.map(item => ({
            locale: item.locale,
            files: [
              ...(item.files ?? []),
              ...(item.namespaces ?? []).map(namespace => `${item.locale}/${namespace}.yaml`),
            ],
          }))
        : Object.entries(pack.manifest.locales ?? {}).map(([locale, names]) => ({
            locale,
            files: names.map(namespace => `${locale}/${namespace}.yaml`),
          }))
      for (const { locale, files } of entries)
        for (const file of files) {
          const value = await pack.readLocale(file)
          if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error(`Invalid native locale: ${file}`)
          const namespace = file
            .split('/')
            .pop()!
            .replace(/\.[^.]+$/, '')
          ;(locales[locale] ??= {})[namespace] = value
        }
    }
    return { data, locales }
  }
}
