// battle/src/v2/data/v2-data-loader.ts
// Load YAML data files in dependency order and populate V2DataRepository.

import { readFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import YAML from 'yaml'
import type { EffectDef } from '@arcadia-eternity/engine'
import { V2DataRepository } from './v2-data-repository.js'
import { parseEffect, parseMark, parseSkill, parseSpecies } from './parsers/index.js'

import { resolvePackReference, resolvePackLoadOrder } from '../../pack/references.js'
import type { DataPackManifest as V2DataPackManifest } from '../../pack/references.js'
export { resolvePackPathFromRef } from '../../pack/references.js'
export type {
  DataPackManifest as V2DataPackManifest,
  DataPackDependency as V2DataPackDependency,
} from '../../pack/references.js'

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
export async function loadV2GameData(_dataDir: string, options: LoadOptions = {}): Promise<LoadResult> {
  const {
    continueOnError = false,
    validateReferences = true,
    packPath,
    packRef = 'builtin:workspace',
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
      await loadMarksFromPaths(
        resolvePathList(item.dataRoot, item.manifest.data.marks),
        repository,
        errors,
        continueOnError,
      )
      await loadSkillsFromPaths(
        resolvePathList(item.dataRoot, item.manifest.data.skills),
        repository,
        errors,
        continueOnError,
      )
      await loadSpeciesFromPaths(
        resolvePathList(item.dataRoot, item.manifest.data.species),
        repository,
        errors,
        continueOnError,
      )
      await loadLocales(normalizeLocaleFiles(item.manifest, item.localesRoot), locales, errors, continueOnError)
    }
    const pack = resolved.entryManifest

    // Optional: validate cross-references
    if (validateReferences) {
      validateCrossReferences(repository, errors)
    }

    return { repository, errors, pack, locales }
  } catch (err) {
    const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error'
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
          const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error'
          errors.push(`${basename(file)}: ${msg}`)
          if (!continueOnError) throw err
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error'
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
  await loadRawArrayFiles(
    files,
    effectParser,
    effect => repo.registerEffect(effect.id, effect),
    errors,
    continueOnError,
  )
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
  await loadRawArrayFiles(
    files,
    parseSpecies,
    species => repo.registerSpecies(species.id, species),
    errors,
    continueOnError,
  )
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
      const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error'
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
