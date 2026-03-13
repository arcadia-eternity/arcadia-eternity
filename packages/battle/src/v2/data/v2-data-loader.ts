// battle/src/v2/data/v2-data-loader.ts
// Load YAML data files in dependency order and populate V2DataRepository.

import { access, readFile } from 'node:fs/promises'
import { basename, dirname, extname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import type { EffectDef } from '@arcadia-eternity/engine'
import { V2DataRepository } from './v2-data-repository.js'
import { parseEffect, parseMark, parseSkill, parseSpecies } from './parsers/index.js'

export interface V2DataPackManifest {
  id: string
  version: string
  engine: 'seer2-v2'
  layoutVersion?: 1
  dependencies?: V2DataPackDependency[]
  paths?: {
    dataDir?: string
    localesDir?: string
  }
  data: {
    effects: string[]
    marks: string[]
    skills: string[]
    species: string[]
  }
  locales?: Record<string, string[]> | Array<{
    locale: string
    files?: string[]
    namespaces?: string[]
  }>
}

export interface V2DataPackDependency {
  path: string
  id?: string
  optional?: boolean
}

export type LocaleBundles = Record<string, Record<string, unknown>>

export interface LoadOptions {
  continueOnError?: boolean
  validateReferences?: boolean
  packPath?: string
  packRef?: string
  effectParser?: (raw: Record<string, unknown>) => EffectDef
}

export interface LoadResult {
  repository: V2DataRepository
  errors: string[]
  pack?: V2DataPackManifest
  locales?: LocaleBundles
}

/**
 * Load all YAML game data from a directory into a V2DataRepository.
 *
 * Files are loaded in dependency order:
 * 1. effect_*.yaml → effects
 * 2. mark_*.yaml → marks (depend on effects)
 * 3. skill*.yaml → skills (depend on effects)
 * 4. species*.yaml → species (depend on marks for ability/emblem)
 *
 * @param dataDir - Directory containing YAML files
 * @param options - Loading options
 * @returns Repository and any errors encountered
 */
export async function loadV2GameData(
  _dataDir: string,
  options: LoadOptions = {},
): Promise<LoadResult> {
  const {
    continueOnError = false,
    validateReferences = true,
    packPath,
    packRef = 'builtin:base',
    effectParser = parseEffect,
  } = options
  const errors: string[] = []
  const repository = new V2DataRepository()
  const locales: LocaleBundles = {}

  try {
    const resolvedPackPath = await resolvePackReference(packRef ?? packPath)
    if (!resolvedPackPath) throw new Error('Pack reference is required')
    const resolved = await resolvePackLoadOrder(resolvedPackPath, continueOnError, errors)
    for (const item of resolved.order) {
      await loadEffectsFromPaths(
        resolvePathList(item.dataRoot, item.manifest.data.effects),
        repository,
        errors,
        continueOnError,
        effectParser,
      )
      await loadMarksFromPaths(resolvePathList(item.dataRoot, item.manifest.data.marks), repository, errors, continueOnError)
      await loadSkillsFromPaths(resolvePathList(item.dataRoot, item.manifest.data.skills), repository, errors, continueOnError)
      await loadSpeciesFromPaths(resolvePathList(item.dataRoot, item.manifest.data.species), repository, errors, continueOnError)
      await loadLocales(normalizeLocaleFiles(item.manifest, item.localesRoot), locales, errors, continueOnError)
    }
    const pack = resolved.entryManifest

    // Optional: validate cross-references
    if (validateReferences) {
      validateCrossReferences(repository, errors)
    }

    return { repository, errors, pack, locales }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    errors.push(`Fatal error loading data: ${message}`)
    if (!continueOnError) throw err
  }

  return { repository, errors, locales: Object.keys(locales).length > 0 ? locales : undefined }
}

export async function loadV2GameDataFromPack(
  packRef: string,
  options: Omit<LoadOptions, 'packPath'> = {},
): Promise<LoadResult> {
  return loadV2GameData('.', { ...options, packRef })
}

export async function resolvePackPathFromRef(packRef: string): Promise<string> {
  const resolvedPackPath = await resolvePackReference(packRef)
  if (!resolvedPackPath) throw new Error('Pack reference is required')
  return resolvedPackPath
}

// ---------------------------------------------------------------------------
// Load helpers
// ---------------------------------------------------------------------------

async function loadRawArrayFiles<T>(
  files: string[],
  parse: (raw: Record<string, unknown>) => T,
  register: (parsed: T) => void,
  errors: string[],
  continueOnError: boolean,
): Promise<void> {
  for (const file of files) {
    try {
      const content = await readFile(file, 'utf-8')
      const parsed = YAML.parse(content, { merge: true })
      if (!Array.isArray(parsed)) {
        errors.push(`${basename(file)}: Expected array, got ${typeof parsed}`)
        continue
      }

      for (const raw of parsed) {
        try {
          const entity = parse(raw as Record<string, unknown>)
          register(entity)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          errors.push(`${basename(file)}: ${msg}`)
          if (!continueOnError) throw err
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${basename(file)}: Failed to load - ${msg}`)
      if (!continueOnError) throw err
    }
  }
}

async function loadEffectsFromPaths(
  files: string[],
  repo: V2DataRepository,
  errors: string[],
  continueOnError: boolean,
  effectParser: (raw: Record<string, unknown>) => EffectDef,
): Promise<void> {
  await loadRawArrayFiles(files, effectParser, effect => repo.registerEffect(effect.id, effect), errors, continueOnError)
}

async function loadMarksFromPaths(
  files: string[],
  repo: V2DataRepository,
  errors: string[],
  continueOnError: boolean,
): Promise<void> {
  await loadRawArrayFiles(files, parseMark, mark => repo.registerMark(mark.id, mark), errors, continueOnError)
}

async function loadSkillsFromPaths(
  files: string[],
  repo: V2DataRepository,
  errors: string[],
  continueOnError: boolean,
): Promise<void> {
  await loadRawArrayFiles(files, parseSkill, skill => repo.registerSkill(skill.id, skill), errors, continueOnError)
}

async function loadSpeciesFromPaths(
  files: string[],
  repo: V2DataRepository,
  errors: string[],
  continueOnError: boolean,
): Promise<void> {
  await loadRawArrayFiles(files, parseSpecies, species => repo.registerSpecies(species.id, species), errors, continueOnError)
}

async function loadPackManifest(packPath: string): Promise<V2DataPackManifest> {
  const raw = JSON.parse(await readFile(packPath, 'utf-8')) as unknown
  if (typeof raw !== 'object' || raw === null) throw new Error(`Invalid pack manifest: ${packPath}`)
  const manifest = raw as V2DataPackManifest
  if (!manifest.id || !manifest.version || manifest.engine !== 'seer2-v2' || !manifest.data) {
    throw new Error(`Invalid pack manifest fields: ${packPath}`)
  }
  return manifest
}

interface PackPackageJsonLike {
  arcadiaEternityPack?: string
}

const requireFromLoader = createRequire(import.meta.url)

async function resolvePackReference(packRef?: string): Promise<string | undefined> {
  if (!packRef || packRef.trim().length === 0) return undefined
  const ref = packRef.trim()
  if (ref === 'builtin:base') {
    return resolvePackReference('npm:@arcadia-eternity/data-pack-base')
  }
  const candidate = ref.startsWith('npm:') ? ref.slice(4) : ref

  if (
    candidate.startsWith('.')
    || candidate.startsWith('/')
    || candidate.startsWith('..')
    || candidate.endsWith('.json')
  ) {
    return resolve(candidate)
  }

  const hashIndex = candidate.indexOf('#')
  const packageName = hashIndex >= 0 ? candidate.slice(0, hashIndex) : candidate
  const explicitPackRelPath = hashIndex >= 0 ? candidate.slice(hashIndex + 1) : undefined
  if (!packageName) throw new Error(`Invalid pack ref '${packRef}'`)

  const packageJsonPath = await resolvePackageJsonPath(packageName)
  const packageRoot = dirname(packageJsonPath)
  if (explicitPackRelPath && explicitPackRelPath.length > 0) {
    return resolve(packageRoot, explicitPackRelPath)
  }

  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8')) as PackPackageJsonLike
  const packEntry = typeof packageJson.arcadiaEternityPack === 'string' && packageJson.arcadiaEternityPack.length > 0
    ? packageJson.arcadiaEternityPack
    : 'pack.json'
  return resolve(packageRoot, packEntry)
}

async function resolvePackageJsonPath(packageName: string): Promise<string> {
  try {
    return requireFromLoader.resolve(`${packageName}/package.json`)
  } catch {
    const workspaceCandidate = await findWorkspacePackageJson(packageName)
    if (workspaceCandidate) return workspaceCandidate
    throw new Error(`Cannot resolve package '${packageName}' from current environment`)
  }
}

async function findWorkspacePackageJson(packageName: string): Promise<string | undefined> {
  const pkgLeaf = packageName.includes('/') ? packageName.split('/').pop() : packageName
  if (!pkgLeaf) return undefined
  let current = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(current, 'packages', pkgLeaf, 'package.json')
    try {
      await access(candidate)
      const raw = JSON.parse(await readFile(candidate, 'utf-8')) as { name?: string }
      if (raw.name === packageName) return candidate
    } catch {
      // continue climbing
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

interface ResolvedPack {
  path: string
  manifest: V2DataPackManifest
  dataRoot: string
  localesRoot: string
}

async function resolvePackLoadOrder(
  entryPackPath: string,
  continueOnError: boolean,
  errors: string[],
): Promise<{ order: ResolvedPack[]; entryManifest: V2DataPackManifest }> {
  const state = new Map<string, 'visiting' | 'done'>()
  const resolved = new Map<string, ResolvedPack>()
  const order: ResolvedPack[] = []

  const visit = async (
    packPathRaw: string,
    fromPackPath?: string,
    expectedId?: string,
    optional?: boolean,
  ): Promise<void> => {
    const packPath = resolve(packPathRaw)
    const currentState = state.get(packPath)
    if (currentState === 'done') return
    if (currentState === 'visiting') {
      const message = `Pack dependency cycle detected at '${packPath}'`
      errors.push(message)
      throw new Error(message)
    }

    let manifest: V2DataPackManifest
    try {
      manifest = await loadPackManifest(packPath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (optional) {
        errors.push(`Optional dependency skipped: ${packPath} (${msg})`)
        return
      }
      throw err
    }

    if (expectedId && manifest.id !== expectedId) {
      const message = `Pack id mismatch for '${packPath}': expected '${expectedId}', got '${manifest.id}'`
      if (optional) {
        errors.push(`Optional dependency skipped: ${message}`)
        return
      }
      errors.push(message)
      throw new Error(message)
    }

    state.set(packPath, 'visiting')
    for (const dep of manifest.dependencies ?? []) {
      const depPath = resolve(dirname(packPath), dep.path)
      try {
        await visit(depPath, packPath, dep.id, dep.optional)
      } catch (err) {
        if (dep.optional || continueOnError) {
          const msg = err instanceof Error ? err.message : String(err)
          errors.push(`Dependency load warning from '${manifest.id}' -> '${dep.path}': ${msg}`)
          continue
        }
        throw err
      }
    }

    const roots = getPackRoots(packPath, manifest)
    const item: ResolvedPack = {
      path: packPath,
      manifest,
      dataRoot: roots.dataRoot,
      localesRoot: roots.localesRoot,
    }
    resolved.set(packPath, item)
    order.push(item)
    state.set(packPath, 'done')
    void fromPackPath
  }

  const entryPath = resolve(entryPackPath)
  await visit(entryPath)
  const entry = resolved.get(entryPath)
  if (!entry) throw new Error(`Failed to resolve entry pack: ${entryPath}`)
  return { order, entryManifest: entry.manifest }
}

function getPackRoots(packPath: string, manifest: V2DataPackManifest): { dataRoot: string; localesRoot: string } {
  const packRoot = dirname(resolve(packPath))
  const dataDir = manifest.paths?.dataDir ?? '.'
  const localesDir = manifest.paths?.localesDir ?? 'locales'
  return {
    dataRoot: resolve(packRoot, dataDir),
    localesRoot: resolve(packRoot, localesDir),
  }
}

function resolvePathList(baseDir: string, files: string[]): string[] {
  return files.map(file => resolve(baseDir, file))
}

function normalizeLocaleFiles(
  manifest: V2DataPackManifest,
  localesRoot: string,
): Array<{ locale: string; file: string }> {
  const out: Array<{ locale: string; file: string }> = []
  if (!manifest.locales) return out
  if (Array.isArray(manifest.locales)) {
    for (const item of manifest.locales) {
      const locale = item.locale
      if (!locale) continue
      const explicit = item.files ?? []
      for (const file of explicit) {
        out.push({ locale, file: resolve(localesRoot, file) })
      }
      const namespaces = item.namespaces ?? []
      for (const ns of namespaces) {
        out.push({ locale, file: resolve(localesRoot, locale, `${ns}.yaml`) })
      }
    }
    return out
  }
  for (const [locale, namespaces] of Object.entries(manifest.locales)) {
    for (const ns of namespaces) {
      out.push({ locale, file: resolve(localesRoot, locale, `${ns}.yaml`) })
    }
  }
  return out
}

async function loadLocales(
  localeFiles: Array<{ locale: string; file: string }>,
  bundles: LocaleBundles,
  errors: string[],
  continueOnError: boolean,
): Promise<void> {
  for (const localeDef of localeFiles) {
    const localeName = localeDef.locale
    if (!localeName) continue
    if (!bundles[localeName]) bundles[localeName] = {}
    const file = localeDef.file
    const namespace = basename(file, extname(file))
    try {
      const content = await readFile(file, 'utf-8')
      bundles[localeName][namespace] = YAML.parse(content, { merge: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`locale:${localeName}:${basename(file)}: Failed to load - ${msg}`)
      if (!continueOnError) throw err
    }
  }
}

// ---------------------------------------------------------------------------
// Cross-reference validation
// ---------------------------------------------------------------------------

function validateCrossReferences(repo: V2DataRepository, errors: string[]): void {
  // Validate skill effectIds reference existing effects
  for (const skill of repo.allSkills()) {
    for (const effectId of skill.effectIds) {
      if (!repo.findEffect(effectId)) {
        errors.push(`Skill '${skill.id}' references unknown effect '${effectId}'`)
      }
    }
  }

  // Validate mark effectIds reference existing effects
  for (const mark of repo.allMarks()) {
    for (const effectId of mark.effectIds) {
      if (!repo.findEffect(effectId)) {
        errors.push(`Mark '${mark.id}' references unknown effect '${effectId}'`)
      }
    }
  }

  // Validate species abilityIds/emblemIds reference existing marks
  for (const species of repo.allSpecies()) {
    for (const abilityId of species.abilityIds) {
      if (!repo.findMark(abilityId)) {
        errors.push(`Species '${species.id}' references unknown ability mark '${abilityId}'`)
      }
    }
    for (const emblemId of species.emblemIds) {
      if (!repo.findMark(emblemId)) {
        errors.push(`Species '${species.id}' references unknown emblem mark '${emblemId}'`)
      }
    }
  }
}
