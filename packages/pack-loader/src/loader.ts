import { V2DataRepository, parseEffect, parseMark, parseSkill, parseSpecies } from '@arcadia-eternity/battle'
import type { PackLoadResult, PackLoadSummary, PackLoaderOptions, PackSource, V2DataPackManifest } from './types'
import { PackTransport, type AssetLoadRecord } from './transport'

const DEFAULT_SOURCE: PackSource = 'node-fs'

export class PackLoader extends PackTransport {
  async load(packRef = 'builtin:base', options: PackLoaderOptions = {}): Promise<PackLoadResult> {
    const source = options.source ?? DEFAULT_SOURCE
    switch (source) {
      case 'node-fs':
        return this.loadFromNodeFs(packRef, options)
      case 'http':
        return this.loadFromHttp(packRef, options)
      default:
        throw new Error(`Unsupported pack source: ${source satisfies never}`)
    }
  }

  summarize(result: PackLoadResult): PackLoadSummary {
    const stats = result.repository.stats()
    return {
      source: result.source,
      packRef: result.packRef,
      packId: result.pack?.id,
      packVersion: result.pack?.version,
      hasLockfile: result.lockfile !== undefined,
      lockfileIssueCount: result.lockfileIssues?.length ?? 0,
      effectCount: stats.effects,
      markCount: stats.marks,
      skillCount: stats.skills,
      speciesCount: stats.species,
      errorCount: result.errors.length,
    }
  }

  private async loadFromNodeFs(packRef: string, options: PackLoaderOptions): Promise<PackLoadResult> {
    const { loadV2GameDataFromPack } = await this.importNodeDataLoader()
    const resolvedPackPath = await this.resolveNodePackPath(packRef)
    const packRaw = await this.readNodeText(resolvedPackPath)
    const loadResult = await loadV2GameDataFromPack(packRef, {
      continueOnError: options.continueOnError ?? false,
      validateReferences: options.validateReferences ?? true,
    })
    const lockfile = await this.loadLockfileFromNodeFs(resolvedPackPath, options)
    const assetRecords = await this.loadAssetsFromNodeFs(resolvedPackPath, loadResult.pack, options, loadResult.errors)
    const lockfileIssues = await this.validateLockfile(lockfile, {
      pack: loadResult.pack,
      packSource: resolvedPackPath,
      packRaw,
      assets: assetRecords,
    })
    this.assertLockfileIssues(lockfileIssues, options)
    return {
      ...loadResult,
      lockfile,
      lockfileIssues,
      assets: assetRecords.map(item => item.manifest),
      source: 'node-fs',
      packRef,
    }
  }

  private async loadFromHttp(packRef: string, options: PackLoaderOptions): Promise<PackLoadResult> {
    const errors: string[] = []
    const repository = new V2DataRepository()
    const entryManifestUrl = this.toAbsoluteHttpUrl(this.resolveManifestUrl(packRef))
    const { order: resolvedPacks, entry } = await this.resolveHttpPackLoadOrder(entryManifestUrl, options, errors)
    const lockfile = await this.loadLockfileFromHttp(entry.manifestUrl, options, errors)
    const assetRecords: AssetLoadRecord[] = []
    let rootAssetRecords: AssetLoadRecord[] = []
    for (const resolved of resolvedPacks) {
      const { records } = await this.loadAssetsFromManifest(resolved.manifest, resolved.manifestUrl, options, errors)
      assetRecords.push(...records)
      if (resolved.manifestUrl === entry.manifestUrl) {
        rootAssetRecords = records
      }
    }
    const conflicts = this.detectAssetConflicts(assetRecords)
    const lockfileIssues = await this.validateLockfile(lockfile, {
      pack: entry.manifest,
      packSource: entry.manifestUrl,
      packRaw: entry.manifestRaw,
      assets: rootAssetRecords,
    })
    this.assertLockfileIssues(lockfileIssues, options)

    const continueOnError = options.continueOnError ?? false
    const loadArrayFiles = async (
      selectFiles: (manifest: V2DataPackManifest) => string[],
      parse: (raw: Record<string, unknown>) => { id: string },
      register: (id: string, value: unknown) => void,
      label: string,
    ): Promise<void> => {
      for (const resolved of resolvedPacks) {
        const files = selectFiles(resolved.manifest)
        for (const file of files) {
          const fileUrl = new URL(file, resolved.dataRoot).toString()
          try {
            const rawItems = await this.fetchArray(fileUrl)
            for (const rawItem of rawItems) {
              try {
                const parsed = parse(rawItem)
                register(parsed.id, parsed)
              } catch (error) {
                const message = `${label} parse error (${resolved.manifest.id}:${file}): ${error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'}`
                errors.push(message)
                if (!continueOnError) throw error
              }
            }
          } catch (error) {
            const message = `${label} load error (${resolved.manifest.id}:${file}): ${error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'}`
            errors.push(message)
            if (!continueOnError) throw error
          }
        }
      }
    }

    await loadArrayFiles(
      current => current.data.effects,
      parseEffect,
      (id, value) => repository.registerEffect(id, value as ReturnType<typeof parseEffect>),
      'effect',
    )
    await loadArrayFiles(
      current => current.data.marks,
      parseMark,
      (id, value) => repository.registerMark(id, value as ReturnType<typeof parseMark>),
      'mark',
    )
    await loadArrayFiles(
      current => current.data.skills,
      parseSkill,
      (id, value) => repository.registerSkill(id, value as ReturnType<typeof parseSkill>),
      'skill',
    )
    await loadArrayFiles(
      current => current.data.species,
      parseSpecies,
      (id, value) => repository.registerSpecies(id, value as ReturnType<typeof parseSpecies>),
      'species',
    )

    return {
      repository,
      errors,
      pack: entry.manifest,
      lockfile,
      lockfileIssues,
      assets: assetRecords.map(item => item.manifest),
      assetConflicts: conflicts,
      source: 'http',
      packRef,
    }
  }

  private async importNodeDataLoader(): Promise<{
    loadV2GameDataFromPack: (
      packRef: string,
      options?: { continueOnError?: boolean; validateReferences?: boolean },
    ) => Promise<{
      repository: V2DataRepository
      errors: string[]
      pack?: V2DataPackManifest
    }>
  }> {
    const specifier = '@arcadia-eternity/battle/node'
    const module = await import(/* @vite-ignore */ specifier)
    return module as {
      loadV2GameDataFromPack: (
        packRef: string,
        options?: { continueOnError?: boolean; validateReferences?: boolean },
      ) => Promise<{
        repository: V2DataRepository
        errors: string[]
        pack?: V2DataPackManifest
      }>
    }
  }
}
