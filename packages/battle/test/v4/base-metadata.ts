import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import type { ContentPrototypeData } from '@arcadia-eternity/battle/v4'

type MetadataKind = 'marks' | 'skills' | 'species'
const root = new URL('../../../../packs/base/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('pack.json', root), 'utf8')) as {
  paths?: { dataDir?: string }
  data: Record<MetadataKind, string[]>
}
const dataRoot = new URL(`${manifest.paths?.dataDir ?? 'data'}/`, root)

export function loadBaseMetadata(kind: MetadataKind): unknown[] {
  return manifest.data[kind].flatMap(file => {
    const records: unknown = parse(readFileSync(new URL(file, dataRoot), 'utf8'), { merge: true })
    if (!Array.isArray(records)) throw new Error(`Expected ${kind} array in ${file}`)
    return records
  })
}

export function loadBasePrototypeData(): ContentPrototypeData {
  return {
    marks: loadBaseMetadata('marks'),
    skills: loadBaseMetadata('skills'),
    species: loadBaseMetadata('species'),
  }
}
