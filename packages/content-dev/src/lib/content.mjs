import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import YAML from 'yaml'
import { isDeepStrictEqual } from 'node:util'

export const contentKinds = ['species', 'skills', 'marks', 'behaviors']
export const sourceKinds = [...contentKinds, 'presentations', 'resources']

async function filesIn(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const files = []
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
export async function readContentSources(root) {
  const directory = join(root, 'data')
  const base = await readFile(join(root, 'pack.json'), 'utf8')
    .then(JSON.parse)
    .catch(error => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (!base && entry.isDirectory() && !entry.name.startsWith('.') && !sourceKinds.includes(entry.name))
      throw new Error(`Unknown content directory: data/${entry.name}`)
  }
  const sources = []
  for (const kind of sourceKinds) {
    const ids = new Map()
    for (const file of base && contentKinds.includes(kind)
      ? (base.data[kind] ?? []).map(file => join(directory, file))
      : await filesIn(join(directory, kind))) {
      const name = relative(root, file)
      const text = await readFile(file, 'utf8')
      let document, value
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
        throw new Error(`Invalid content in ${name}: ${error.message}`, { cause: error })
      }
      const records = Array.isArray(value) ? value : [value]
      for (const record of records) {
        if (
          !record ||
          typeof record !== 'object' ||
          Array.isArray(record) ||
          typeof record.id !== 'string' ||
          !record.id
        )
          throw new Error(`Each record needs an id: ${name}`)
        if (ids.has(record.id)) throw new Error(`Duplicate ${kind} id ${record.id}: ${ids.get(record.id)} and ${name}`)
        ids.set(record.id, name)
      }
      sources.push({ kind, file, text, document, value, records })
    }
  }
  return sources
}

/** File names and grouping do not enter runtime IDs or record ordering. */
export function assembleContent(sources) {
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
