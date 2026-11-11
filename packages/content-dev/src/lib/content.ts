import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import type { Dirent } from 'node:fs'
import YAML from 'yaml'
import { isDeepStrictEqual } from 'node:util'
import type { Document } from 'yaml'
import { errorCode, errorMessage, isRecord, type UnknownRecord } from '../types.ts'

const contentKinds = ['species', 'skills', 'marks', 'behaviors'] as const
const sourceKinds = [...contentKinds, 'presentations', 'resources'] as const

type SourceKind = (typeof sourceKinds)[number]

export interface ContentSource {
  kind: SourceKind
  file: string
  text: string
  document: Document | undefined
  value: unknown
  records: Array<Record<string, unknown> & { id: string }>
}

async function filesIn(directory: string): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return []
    throw error
  }
  const files: string[] = []
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (entry.name.startsWith('.')) continue
    const file = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await filesIn(file)))
    else if (entry.isSymbolicLink()) throw new Error(`Content sources must be ordinary files: ${file}`)
    else if (['.json', '.yaml', '.yml'].includes(extname(entry.name))) files.push(file)
  }
  return files
}

/** Editable source files; each file may hold one record or an array of records. */
export async function readContentSources(root: string): Promise<ContentSource[]> {
  const directory = join(root, 'data')
  const base: (UnknownRecord & { data?: Record<string, unknown> }) | undefined = await readFile(
    join(root, 'pack.json'),
    'utf8',
  )
    .then(JSON.parse)
    .catch((error: unknown) => {
      if (errorCode(error) === 'ENOENT') return undefined
      throw error
    })
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (
      !base &&
      entry.isDirectory() &&
      !entry.name.startsWith('.') &&
      !(sourceKinds as readonly string[]).includes(entry.name)
    )
      throw new Error(`Unknown content directory: data/${entry.name}`)
  }
  const sources: ContentSource[] = []
  for (const kind of sourceKinds) {
    const ids = new Map<string, string>()
    const baseFiles =
      base && (contentKinds as readonly string[]).includes(kind)
        ? ((base.data?.[kind] ?? []) as string[]).map(file => join(directory, file))
        : undefined
    for (const file of baseFiles ?? (await filesIn(join(directory, kind)))) {
      const name = relative(root, file)
      const text = await readFile(file, 'utf8')
      let document: Document | undefined, value: unknown
      try {
        if (extname(file) === '.json') value = JSON.parse(text)
        else {
          document = YAML.parseDocument(text, { merge: true })
          if (document.errors.length) throw document.errors[0]
          value = document.toJS()
        }
        if (!isDeepStrictEqual(JSON.parse(JSON.stringify(value)), value))
          throw new Error('Content values must be finite JSON-compatible data')
      } catch (error) {
        throw new Error(`Invalid content in ${name}: ${errorMessage(error)}`, { cause: error })
      }
      const records = Array.isArray(value) ? value : [value]
      for (const record of records) {
        if (!isRecord(record) || typeof record.id !== 'string' || !record.id)
          throw new Error(`Each record needs an id: ${name}`)
        if (ids.has(record.id)) throw new Error(`Duplicate ${kind} id ${record.id}: ${ids.get(record.id)} and ${name}`)
        ids.set(record.id, name)
      }
      sources.push({
        kind,
        file,
        text,
        document,
        value,
        records: records as Array<Record<string, unknown> & { id: string }>,
      })
    }
  }
  return sources
}

/** File names and grouping do not enter runtime IDs or record ordering. */
export function assembleContent(sources: ContentSource[]) {
  return {
    data: Object.fromEntries(
      contentKinds.map(kind => [
        kind,
        sources
          .filter(source => source.kind === kind)
          .flatMap(source => source.records)
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      ]),
    ),
  }
}
