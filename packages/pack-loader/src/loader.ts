import { V2DataRepository, parseEffect, parseMark, parseSkill, parseSpecies } from '@arcadia-eternity/battle'
import type { AssetConflict, PackLoadResult, PackLoadSummary, PackLoaderOptions, PackLockfile, PackSource } from './types'
import YAML from 'yaml'
import type { V2DataPackManifest } from './types'
import type { AssetManifest } from '@arcadia-eternity/schema/src/assets.js'

const DEFAULT_SOURCE: PackSource = 'node-fs'

type AssetLoadRecord = {
  manifest: AssetManifest
  url: string
  raw: string
}

export class PackLoader {
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

    const manifestUrl = this.toAbsoluteHttpUrl(this.resolveManifestUrl(packRef))
    const manifestRaw = await this.fetchText(manifestUrl)
    const manifest = JSON.parse(manifestRaw) as V2DataPackManifest
    const lockfile = await this.loadLockfileFromHttp(manifestUrl, options, errors)
    const dataRoot = this.resolveDirectoryUrl(manifest.paths?.dataDir ?? '.', manifestUrl)
    const { records: assetRecords, conflicts } = await this.loadAssetsFromManifest(manifest, manifestUrl, options, errors)
    const lockfileIssues = await this.validateLockfile(lockfile, {
      pack: manifest,
      packSource: manifestUrl,
      packRaw: manifestRaw,
      assets: assetRecords,
    })
    this.assertLockfileIssues(lockfileIssues, options)

    const continueOnError = options.continueOnError ?? false
    const loadArrayFiles = async (
      files: string[],
      parse: (raw: Record<string, unknown>) => { id: string },
      register: (id: string, value: unknown) => void,
      label: string,
    ): Promise<void> => {
      for (const file of files) {
        const fileUrl = new URL(file, dataRoot).toString()
        try {
          const rawItems = await this.fetchArray(fileUrl)
          for (const rawItem of rawItems) {
            try {
              const parsed = parse(rawItem)
              register(parsed.id, parsed)
            } catch (error) {
              const message = `${label} parse error (${file}): ${error instanceof Error ? error.message : String(error)}`
              errors.push(message)
              if (!continueOnError) throw error
            }
          }
        } catch (error) {
          const message = `${label} load error (${file}): ${error instanceof Error ? error.message : String(error)}`
          errors.push(message)
          if (!continueOnError) throw error
        }
      }
    }

    await loadArrayFiles(
      manifest.data.effects,
      parseEffect,
      (id, value) => repository.registerEffect(id, value as ReturnType<typeof parseEffect>),
      'effect',
    )
    await loadArrayFiles(
      manifest.data.marks,
      parseMark,
      (id, value) => repository.registerMark(id, value as ReturnType<typeof parseMark>),
      'mark',
    )
    await loadArrayFiles(
      manifest.data.skills,
      parseSkill,
      (id, value) => repository.registerSkill(id, value as ReturnType<typeof parseSkill>),
      'skill',
    )
    await loadArrayFiles(
      manifest.data.species,
      parseSpecies,
      (id, value) => repository.registerSpecies(id, value as ReturnType<typeof parseSpecies>),
      'species',
    )

    return {
      repository,
      errors,
      pack: manifest,
      lockfile,
      lockfileIssues,
      assets: assetRecords.map(item => item.manifest),
      assetConflicts: conflicts,
      source: 'http',
      packRef,
    }
  }

  private async loadAssetsFromManifest(
    manifest: V2DataPackManifest,
    manifestUrl: string,
    options: PackLoaderOptions,
    errors: string[],
  ): Promise<{ records: AssetLoadRecord[]; conflicts: AssetConflict[] }> {
    if (!manifest.assetsRef) return { records: [], conflicts: [] }
    const continueOnError = options.continueOnError ?? false
    const refs = Array.isArray(manifest.assetsRef) ? manifest.assetsRef : [manifest.assetsRef]
    const loaded: AssetLoadRecord[] = []
    const visited = new Set<string>()
    const stack = new Set<string>()

    const walk = async (assetRef: string, relativeToUrl: string): Promise<void> => {
      const url = this.resolveAssetManifestUrl(assetRef, relativeToUrl)
      if (stack.has(url)) {
        const message = `asset manifest cycle detected: ${[...stack, url].join(' -> ')}`
        if (!continueOnError) throw new Error(message)
        errors.push(message)
        return
      }
      if (visited.has(url)) return
      stack.add(url)
      try {
        const assetManifestRaw = await this.fetchText(url)
        const assetManifest = JSON.parse(assetManifestRaw) as AssetManifest
        const dependencies = assetManifest.dependencies ?? []
        for (const depRef of dependencies) {
          await walk(depRef, url)
        }
        const normalized: AssetManifest = {
          ...assetManifest,
          assets: assetManifest.assets.map(entry => ({
            ...entry,
            uri: this.resolveAssetUri(entry.uri, url),
          })),
        }
        loaded.push({ manifest: normalized, url, raw: assetManifestRaw })
        visited.add(url)
      } catch (error) {
        const message = `asset manifest load error (${assetRef}): ${error instanceof Error ? error.message : String(error)}`
        if (!continueOnError) throw error
        errors.push(message)
      } finally {
        stack.delete(url)
      }
    }

    for (const ref of refs) {
      await walk(ref, manifestUrl)
    }

    const conflicts = this.detectAssetConflicts(loaded)
    return { records: loaded, conflicts }
  }

  private detectAssetConflicts(loaded: AssetLoadRecord[]): AssetConflict[] {
    const conflicts: AssetConflict[] = []
    const assetUriById = new Map<string, string>()
    const mappingByScope = {
      species: new Map<string, string>(),
      marks: new Map<string, string>(),
      skills: new Map<string, string>(),
    }

    for (const item of loaded) {
      const { manifest, url } = item
      for (const asset of manifest.assets) {
        const previous = assetUriById.get(asset.id)
        if (previous !== undefined && previous !== asset.uri) {
          conflicts.push({
            kind: 'assetUri',
            scope: 'assets',
            key: asset.id,
            previous,
            next: asset.uri,
            manifestId: manifest.id,
            manifestVersion: manifest.version,
            manifestUrl: url,
          })
        }
        assetUriById.set(asset.id, asset.uri)
      }

      const mappingSources: Array<{
        scope: 'species' | 'marks' | 'skills'
        mapping?: Record<string, string>
      }> = [
        { scope: 'species', mapping: manifest.mappings?.species },
        { scope: 'marks', mapping: manifest.mappings?.marks },
        { scope: 'skills', mapping: manifest.mappings?.skills },
      ]
      for (const source of mappingSources) {
        if (!source.mapping) continue
        const scoped = mappingByScope[source.scope]
        for (const [key, next] of Object.entries(source.mapping)) {
          const previous = scoped.get(key)
          if (previous !== undefined && previous !== next) {
            conflicts.push({
              kind: 'mapping',
              scope: source.scope,
              key,
              previous,
              next,
              manifestId: manifest.id,
              manifestVersion: manifest.version,
              manifestUrl: url,
            })
          }
          scoped.set(key, next)
        }
      }
    }
    return conflicts
  }

  private resolveManifestUrl(packRef: string): string {
    return packRef.endsWith('.json') ? packRef : `${packRef.replace(/\/+$/, '')}/pack.json`
  }

  private async resolveNodePackPath(packRef: string): Promise<string> {
    const { resolvePackPathFromRef } = await this.importNodePackResolver()
    return resolvePackPathFromRef(packRef)
  }

  private async loadLockfileFromNodeFs(
    packPath: string,
    options: PackLoaderOptions,
  ): Promise<PackLockfile | undefined> {
    const continueOnError = options.continueOnError ?? false
    const [{ dirname, resolve }, { readFile }] = await Promise.all([
      import('node:path'),
      import('node:fs/promises'),
    ])
    const lockfilePath = resolve(dirname(packPath), 'pack-lock.yaml')
    try {
      const raw = await readFile(lockfilePath, 'utf8')
      return this.parseLockfile(raw, lockfilePath)
    } catch (error) {
      if (!this.isMissingFileError(error)) {
        if (!continueOnError) throw error
      }
      return undefined
    }
  }

  private async loadLockfileFromHttp(
    manifestUrl: string,
    options: PackLoaderOptions,
    errors: string[],
  ): Promise<PackLockfile | undefined> {
    const continueOnError = options.continueOnError ?? false
    const lockfileUrl = new URL('pack-lock.yaml', manifestUrl).toString()
    try {
      const raw = await this.fetchText(lockfileUrl)
      return this.parseLockfile(raw, lockfileUrl)
    } catch (error) {
      if (this.isMissingHttpError(error)) return undefined
      const message = `pack lockfile load error (${lockfileUrl}): ${error instanceof Error ? error.message : String(error)}`
      if (!continueOnError) throw new Error(message)
      errors.push(message)
      return undefined
    }
  }

  private parseLockfile(raw: string, source: string): PackLockfile {
    const parsed = YAML.parse(raw) as PackLockfile & { generatedAt?: any }
    const generatedAtValue: any = parsed?.generatedAt
    const generatedAt =
      typeof generatedAtValue === 'string'
        ? generatedAtValue
        : generatedAtValue instanceof Date
          ? generatedAtValue.toISOString()
          : undefined
    if (
      typeof parsed !== 'object'
      || parsed === null
      || parsed.lockfileVersion !== 1
      || generatedAt === undefined
      || typeof parsed.importers !== 'object'
      || parsed.importers === null
      || typeof parsed.packages !== 'object'
      || parsed.packages === null
    ) {
      throw new Error(`Invalid pack lockfile: ${source}`)
    }
    return {
      ...parsed,
      generatedAt,
    }
  }

  private async validateLockfile(
    lockfile: PackLockfile | undefined,
    context: {
      pack: V2DataPackManifest | undefined
      packSource: string
      packRaw: string
      assets: AssetLoadRecord[]
    },
  ): Promise<string[]> {
    const { pack, packSource, packRaw, assets } = context
    if (!lockfile || !pack) return []
    const issues: string[] = []
    const importer = lockfile.importers['.']
    if (!importer) {
      issues.push("lockfile missing root importer '.'")
      return issues
    }

    const rootDependency = importer.dependencies?.[pack.id]
    const rootSnapshot = rootDependency?.packageKey
      ? lockfile.packages[rootDependency.packageKey]
      : this.findPackageSnapshot(lockfile, pack.id, pack.version, 'data')

    if (!rootDependency) {
      issues.push(`lockfile importer missing dependency for pack '${pack.id}'`)
    }
    if (!rootSnapshot) {
      issues.push(`lockfile missing data package snapshot for '${pack.id}@${pack.version}'`)
      return issues
    }

    if (rootSnapshot.kind !== 'data') issues.push(`lockfile package '${pack.id}' should be kind=data`)
    if (rootSnapshot.version !== pack.version) {
      issues.push(`lockfile version mismatch for '${pack.id}': expected ${pack.version}, got ${rootSnapshot.version}`)
    }
    if (rootSnapshot.engine !== pack.engine) {
      issues.push(`lockfile engine mismatch for '${pack.id}': expected ${pack.engine}, got ${rootSnapshot.engine}`)
    }
    if (rootSnapshot.entry !== 'pack.json') {
      issues.push(`lockfile entry mismatch for '${pack.id}': expected pack.json, got ${rootSnapshot.entry}`)
    }
    if (!this.matchesExpectedSource(rootSnapshot.source, packSource)) {
      issues.push(`lockfile source mismatch for '${pack.id}': expected ${packSource}, got ${rootSnapshot.source}`)
    }
    const packIntegrity = await this.computeIntegrity(packRaw)
    if (rootSnapshot.resolution?.integrity && rootSnapshot.resolution.integrity !== packIntegrity) {
      issues.push(`lockfile integrity mismatch for '${pack.id}'`)
    }

    for (const assetRecord of assets) {
      const asset = assetRecord.manifest
      const expectedKey = rootSnapshot.dependencies?.[asset.id]
      const assetSnapshot = expectedKey
        ? lockfile.packages[expectedKey]
        : this.findPackageSnapshot(lockfile, asset.id, asset.version, 'asset')
      if (!assetSnapshot) {
        issues.push(`lockfile missing asset package snapshot for '${asset.id}@${asset.version}'`)
        continue
      }
      if (assetSnapshot.kind !== 'asset') {
        issues.push(`lockfile package '${asset.id}' should be kind=asset`)
      }
      if (assetSnapshot.version !== asset.version) {
        issues.push(`lockfile version mismatch for asset '${asset.id}': expected ${asset.version}, got ${assetSnapshot.version}`)
      }
      if (assetSnapshot.engine !== asset.engine) {
        issues.push(`lockfile engine mismatch for asset '${asset.id}': expected ${asset.engine}, got ${assetSnapshot.engine}`)
      }
      if (assetSnapshot.entry !== 'assets.json') {
        issues.push(`lockfile entry mismatch for asset '${asset.id}': expected assets.json, got ${assetSnapshot.entry}`)
      }
      if (!this.matchesExpectedSource(assetSnapshot.source, assetRecord.url)) {
        issues.push(`lockfile source mismatch for asset '${asset.id}': expected ${assetRecord.url}, got ${assetSnapshot.source}`)
      }
      const assetIntegrity = await this.computeIntegrity(assetRecord.raw)
      if (assetSnapshot.resolution?.integrity && assetSnapshot.resolution.integrity !== assetIntegrity) {
        issues.push(`lockfile integrity mismatch for asset '${asset.id}'`)
      }
      if (!expectedKey) {
        issues.push(`lockfile root package missing dependency edge to asset '${asset.id}'`)
      }
    }

    return issues
  }

  private findPackageSnapshot(
    lockfile: PackLockfile,
    name: string,
    version: string,
    kind: 'data' | 'asset',
  ): PackLockfile['packages'][string] | undefined {
    return Object.values(lockfile.packages).find(
      snapshot => snapshot.name === name && snapshot.version === version && snapshot.kind === kind,
    )
  }

  private assertLockfileIssues(issues: string[], options: PackLoaderOptions): void {
    if (issues.length === 0) return
    if (options.enforceLockfile) {
      throw new Error(`Pack lockfile validation failed: ${issues.join('; ')}`)
    }
  }

  private matchesExpectedSource(actual: string, expectedPathOrUrl: string): boolean {
    if (actual.startsWith('workspace:')) return true
    if (actual.startsWith('file:')) return actual === `file:${expectedPathOrUrl}`
    if (actual.startsWith('http://') || actual.startsWith('https://')) return actual === expectedPathOrUrl
    return actual === expectedPathOrUrl
  }

  private isMissingFileError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
  }

  private isMissingHttpError(error: unknown): boolean {
    return error instanceof Error && /HTTP 404\b/.test(error.message)
  }

  private resolveAssetManifestUrl(assetRef: string, manifestUrl: string): string {
    if (assetRef.startsWith('http://') || assetRef.startsWith('https://')) {
      return assetRef
    }
    const normalized = assetRef.endsWith('.json') ? assetRef : `${assetRef.replace(/\/+$/, '')}/assets.json`
    return new URL(normalized, manifestUrl).toString()
  }

  private resolveAssetUri(uri: string, assetManifestUrl: string): string {
    // Keep already absolute/protocol URIs as-is (http, https, file, tauri, asset, data, blob...)
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(uri)) {
      return uri
    }
    // Resolve package-relative/bundled file URIs against assets.json location.
    return new URL(uri, assetManifestUrl).toString()
  }

  private resolveDirectoryUrl(dir: string, baseUrl: string): URL {
    const normalizedDir = dir === '.' ? './' : `${dir.replace(/\/+$/, '')}/`
    return new URL(normalizedDir, baseUrl)
  }

  private toAbsoluteHttpUrl(urlOrPath: string): string {
    return new URL(urlOrPath, this.getHttpBaseUrl()).toString()
  }

  private getHttpBaseUrl(): string {
    const maybeLocation = (globalThis as { location?: { href?: string } }).location
    if (typeof maybeLocation?.href === 'string' && maybeLocation.href.length > 0) {
      return maybeLocation.href
    }
    return 'http://localhost/'
  }

  private async fetchArray(url: string): Promise<Record<string, unknown>[]> {
    try {
      const text = await this.fetchText(url)
      const isJson = url.toLowerCase().endsWith('.json')
      const parsed = isJson ? JSON.parse(text) : YAML.parse(text, { merge: true })
      if (!Array.isArray(parsed)) {
        throw new Error(`Expected array content from ${url}`)
      }
      return parsed as Record<string, unknown>[]
    } catch (error) {
      if (url.endsWith('.yaml')) {
        const jsonUrl = url.replace(/\.yaml$/, '.json')
        const text = await this.fetchText(jsonUrl)
        const parsed = JSON.parse(text)
        if (!Array.isArray(parsed)) {
          throw new Error(`Expected array content from ${jsonUrl}`)
        }
        return parsed as Record<string, unknown>[]
      }
      throw error
    }
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const text = await this.fetchText(url)
    return JSON.parse(text) as T
  }

  private async fetchText(url: string): Promise<string> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`)
    }
    return response.text()
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

  private async importNodePackResolver(): Promise<{
    resolvePackPathFromRef: (packRef: string) => Promise<string>
  }> {
    const specifier = '@arcadia-eternity/battle/node'
    const module = await import(/* @vite-ignore */ specifier)
    return module as {
      resolvePackPathFromRef: (packRef: string) => Promise<string>
    }
  }

  private async loadAssetsFromNodeFs(
    packPath: string,
    manifest: V2DataPackManifest | undefined,
    options: PackLoaderOptions,
    errors: string[],
  ): Promise<AssetLoadRecord[]> {
    if (!manifest?.assetsRef) return []
    const continueOnError = options.continueOnError ?? false
    const refs = Array.isArray(manifest.assetsRef) ? manifest.assetsRef : [manifest.assetsRef]
    const { dirname, resolve } = await import('node:path')
    const loaded: AssetLoadRecord[] = []
    const visited = new Set<string>()
    const stack = new Set<string>()

    const walk = async (assetRef: string, relativeToPath: string): Promise<void> => {
      const assetPaths = await this.resolveNodeAssetManifestPaths(assetRef, relativeToPath)
      for (const assetPath of assetPaths) {
        if (stack.has(assetPath)) {
          const message = `asset manifest cycle detected: ${[...stack, assetPath].join(' -> ')}`
          if (!continueOnError) throw new Error(message)
          errors.push(message)
          continue
        }
        if (visited.has(assetPath)) continue
        stack.add(assetPath)
        try {
          const raw = await this.readNodeText(assetPath)
          const assetManifest = JSON.parse(raw) as AssetManifest
          for (const dep of assetManifest.dependencies ?? []) {
            await walk(dep, assetPath)
          }
          loaded.push({
            manifest: assetManifest,
            url: assetPath,
            raw,
          })
          visited.add(assetPath)
        } catch (error) {
          const message = `asset manifest load error (${assetRef}): ${error instanceof Error ? error.message : String(error)}`
          if (!continueOnError) throw error
          errors.push(message)
        } finally {
          stack.delete(assetPath)
        }
      }
    }

    for (const ref of refs) {
      await walk(ref, packPath)
    }
    return loaded
  }

  private async resolveNodeAssetManifestPaths(assetRef: string, relativeToPath: string): Promise<string[]> {
    const { dirname, resolve, basename } = await import('node:path')
    const { stat, readdir } = await import('node:fs/promises')
    const basePath = resolve(dirname(relativeToPath), assetRef)

    try {
      const baseStat = await stat(basePath)
      if (!baseStat.isDirectory()) {
        return [basePath]
      }
      const entries = await readdir(basePath, { withFileTypes: true })
      const jsonFiles = entries
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
        .map(entry => resolve(basePath, entry.name))
      if (jsonFiles.length === 0) {
        return [resolve(basePath, 'assets.json')]
      }
      jsonFiles.sort((a, b) => {
        const aIsDefault = basename(a).toLowerCase() === 'assets.json'
        const bIsDefault = basename(b).toLowerCase() === 'assets.json'
        if (aIsDefault && !bIsDefault) return -1
        if (!aIsDefault && bIsDefault) return 1
        return a.localeCompare(b)
      })
      return jsonFiles
    } catch {
      const normalizedRef = assetRef.endsWith('.json') ? assetRef : `${assetRef.replace(/\/+$/, '')}/assets.json`
      return [resolve(dirname(relativeToPath), normalizedRef)]
    }
  }

  private async readNodeText(path: string): Promise<string> {
    const { readFile } = await import('node:fs/promises')
    return readFile(path, 'utf8')
  }

  private async computeIntegrity(content: string): Promise<string> {
    const bytes = new TextEncoder().encode(content)
    const digest = await globalThis.crypto.subtle.digest('SHA-512', bytes)
    const hashBytes = new Uint8Array(digest)
    let base64: string
    if (typeof Buffer !== 'undefined') {
      base64 = Buffer.from(hashBytes).toString('base64')
    } else {
      let binary = ''
      for (const byte of hashBytes) binary += String.fromCharCode(byte)
      base64 = btoa(binary)
    }
    return `sha512-${base64}`
  }
}
