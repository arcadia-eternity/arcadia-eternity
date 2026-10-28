import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join, relative, extname } from 'node:path'
import YAML from 'yaml'

const maximumBytes = 64 * 1024 * 1024
const mimeTypes = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.swf': 'application/x-shockwave-flash',
}
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const remote = value => /^https?:\/\//.test(value)
export function resourceReferences(presentation) {
  if (!presentation) return []
  if (typeof presentation !== 'object' || Array.isArray(presentation)) throw new Error('presentation must be an object')
  const keys = ['icon', 'portrait', 'cry', 'sfx', 'background', 'music', 'battle']
  for (const key of Object.keys(presentation))
    if (!keys.includes(key)) throw new Error(`Unknown presentation field: ${key}`)
  const refs = keys
    .filter(key => key !== 'battle')
    .flatMap(key => (presentation[key] === undefined ? [] : [presentation[key]]))
  if (presentation.battle) {
    const battle = presentation.battle
    if (
      !['image', 'seer2-swf'].includes(battle.renderer) ||
      !battle.source ||
      Object.keys(battle).some(key => !['renderer', 'source', 'fallback'].includes(key))
    )
      throw new Error('Invalid battle presentation')
    refs.push(battle.source)
    if (battle.fallback !== undefined) refs.push(battle.fallback)
  }
  for (const ref of refs) {
    if (typeof ref === 'string' && ref.length && (remote(ref) || validAssetPath(ref))) continue
    if (
      ref &&
      typeof ref === 'object' &&
      !Array.isArray(ref) &&
      typeof ref.namespace === 'string' &&
      ref.namespace &&
      typeof ref.path === 'string' &&
      validAssetPath(ref.path) &&
      Object.keys(ref).every(key => ['namespace', 'path'].includes(key))
    )
      continue
    throw new Error(`Invalid presentation resource: ${JSON.stringify(ref)}`)
  }
  return refs
}
function validAssetPath(value) {
  return (
    value.startsWith('assets/') &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    value.split('/').every(part => part && part !== '.' && part !== '..')
  )
}
async function files(root, directory) {
  let entries
  try {
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(`Presentation directory must be an ordinary directory: ${relative(root, directory)}`)
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const output = []
  for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
    if (entry.name.startsWith('.')) continue
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Presentation sources must be ordinary files: ${relative(root, path)}`)
    if (entry.isDirectory()) output.push(...(await files(root, path)))
    else if (entry.isFile()) output.push(path)
  }
  return output
}
function metadata(id, bytes, mime) {
  if (!bytes.length || bytes.length > maximumBytes) throw new Error(`Resource size invalid: ${id}`)
  return {
    kind: 'file',
    id,
    source: id,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    mime,
  }
}
/** Remote URLs are declarations only: no downloads, copies, or byte cache. */
export async function buildPresentation(root, sources) {
  const resources = []
  for (const file of await files(root, join(root, 'assets'))) {
    const id = relative(root, file).split('\\').join('/')
    const mime = mimeTypes[extname(file).toLowerCase()]
    if (!mime) throw new Error(`Unsupported asset file: ${id}`)
    const info = await lstat(file)
    if (info.size > maximumBytes) throw new Error(`Resource exceeds 64 MiB: ${id}`)
    resources.push(metadata(id, await readFile(file), mime))
  }
  const urls = new Set()
  const byId = new Map(resources.map(resource => [resource.id, resource]))
  for (const source of sources)
    for (const record of source.records) {
      let refs
      try {
        refs = resourceReferences(record.presentation)
      } catch (error) {
        throw new Error(`${relative(root, source.file)}: ${error.message}`, { cause: error })
      }
      for (const ref of refs)
        if (typeof ref === 'string') {
          if (remote(ref)) urls.add(ref)
          else if (!byId.has(ref)) throw new Error(`${relative(root, source.file)}: Missing resource ${ref}`)
        }
    }
  for (const url of [...urls].sort(compare)) {
    const parsed = new URL(url)
    if (parsed.username || parsed.password) throw new Error(`Resource URL must not contain credentials: ${url}`)
    const mime = mimeTypes[extname(parsed.pathname).toLowerCase()]
    resources.push({ kind: 'http', id: url, source: url, ...(mime ? { mime } : {}) })
  }
  const locales = {}
  for (const file of await files(root, join(root, 'locales'))) {
    const path = relative(join(root, 'locales'), file).split('\\').join('/')
    const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9_-]+)\.(json|ya?ml)$/.exec(path)
    if (!match) throw new Error(`Expected locales/<language>/<namespace>.json|yaml: ${path}`)
    const [, language, namespace] = match
    const canonicalLanguage = Intl.getCanonicalLocales(language)[0]
    const text = await readFile(file, 'utf8')
    const value = match[3] === 'json' ? JSON.parse(text) : YAML.parse(text, { uniqueKeys: true })
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected locale object: ${path}`)
    const records = {
      species: 'species',
      skill: 'skills',
      mark: 'marks',
      mark_ability: 'marks',
      mark_emblem: 'marks',
      mark_global: 'marks',
    }[namespace]
    if (!records) throw new Error(`Unsupported content locale namespace: ${path}`)
    const ids = new Set(
      sources.filter(source => source.kind === records).flatMap(source => source.records.map(record => record.id)),
    )
    for (const [id, entry] of Object.entries(value)) {
      if (!ids.has(id)) throw new Error(`${path}: Unknown content ID ${id}`)
      if (
        !entry ||
        typeof entry !== 'object' ||
        Array.isArray(entry) ||
        Object.entries(entry).some(
          ([field, text]) => !['name', 'description'].includes(field) || typeof text !== 'string',
        )
      )
        throw new Error(`${path}: Expected name/description strings for ${id}`)
    }
    const target = (locales[canonicalLanguage] ??= {})
    if (Object.hasOwn(target, namespace)) throw new Error(`Duplicate locale namespace: ${path}`)
    target[namespace] = value
  }
  return { version: 1, defaultLocale: 'zh-CN', resources: resources.sort((a, b) => compare(a.id, b.id)), locales }
}
