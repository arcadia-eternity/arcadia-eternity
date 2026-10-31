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
    if (typeof ref === 'string' && validResourceId(ref)) continue
    if (
      ref &&
      typeof ref === 'object' &&
      !Array.isArray(ref) &&
      typeof ref.namespace === 'string' &&
      ref.namespace &&
      typeof ref.id === 'string' &&
      validResourceId(ref.id) &&
      Object.keys(ref).every(key => ['namespace', 'id'].includes(key))
    )
      continue
    throw new Error(`Invalid presentation resource: ${JSON.stringify(ref)}`)
  }
  return refs
}
export const validResourceId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value)
export function validAssetPath(value) {
  return (
    typeof value === 'string' &&
    !value.startsWith('/') &&
    !value.includes(':') &&
    !value.split('/').some(part => ['node_modules', '.git', '.arcadia', 'dist'].includes(part)) &&
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
export function bindingPresentation(binding) {
  const { id: _id, target: _target, ...presentation } = binding
  return presentation
}
export function validateBinding(binding, sources) {
  if (
    !binding.target ||
    !['species', 'skills', 'marks'].includes(binding.target.kind) ||
    typeof binding.target.id !== 'string' ||
    Object.keys(binding.target).some(key => !['kind', 'id'].includes(key))
  )
    throw new Error(`Invalid presentation target: ${binding.id}`)
  if (
    !sources.some(
      source => source.kind === binding.target.kind && source.records.some(row => row.id === binding.target.id),
    )
  )
    throw new Error(`Missing presentation target: ${binding.target.kind}/${binding.target.id}`)
  return resourceReferences(bindingPresentation(binding))
}
/** Read only declared files. References are IDs; locations never become resource identities. */
export async function buildPresentation(root, sources, { includeLocales = true } = {}) {
  const resources = []
  const definitions = sources.filter(source => source.kind === 'resources')
  for (const source of definitions)
    for (const record of source.records) {
      const { id, source: location, kind, name: _name } = record
      if (
        !validResourceId(id) ||
        !['image', 'audio', 'swf'].includes(kind) ||
        typeof location !== 'string' ||
        Object.keys(record).some(key => !['id', 'source', 'kind', 'name', 'tags'].includes(key)) ||
        (record.name !== undefined && typeof record.name !== 'string') ||
        (record.tags !== undefined && (!Array.isArray(record.tags) || record.tags.some(tag => typeof tag !== 'string')))
      )
        throw new Error(`${relative(root, source.file)}: Invalid resource definition ${id}`)
      const url = remote(location) ? new URL(location) : undefined
      if (url && (url.username || url.password)) throw new Error(`Resource URL must not contain credentials: ${id}`)
      const mime = mimeTypes[extname(url ? url.pathname : location).toLowerCase()]
      if (
        !mime ||
        (kind === 'image'
          ? !mime.startsWith('image/')
          : kind === 'audio'
            ? !mime.startsWith('audio/')
            : mime !== 'application/x-shockwave-flash')
      )
        throw new Error(`Resource type does not match source: ${id}`)
      if (url) {
        resources.push({ kind: 'http', id, source: location, mime, ...(record.tags ? { tags: record.tags } : {}) })
        continue
      }
      if (!validAssetPath(location)) throw new Error(`Invalid resource path: ${id}`)
      let path = root
      for (const part of location.split('/')) {
        path = join(path, part)
        if ((await lstat(path)).isSymbolicLink()) throw new Error(`Resource must not use symbolic links: ${id}`)
      }
      const info = await lstat(path)
      if (!info.isFile() || !info.size || info.size > maximumBytes) throw new Error(`Resource size invalid: ${id}`)
      const bytes = await readFile(path)
      if (!bytes.length || bytes.length > maximumBytes) throw new Error(`Resource size invalid: ${id}`)
      resources.push({
        kind: 'file',
        id,
        source: location,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
        mime,
        ...(record.tags ? { tags: record.tags } : {}),
      })
    }
  const ids = new Set(resources.map(row => row.id))
  const kinds = new Map(definitions.flatMap(source => source.records).map(row => [row.id, row.kind]))
  const bindings = []
  const targets = new Set()
  for (const source of sources)
    for (const record of source.records) {
      if (
        !['presentations', 'resources'].includes(source.kind) &&
        ['presentation', 'assetRef', 'iconRef', 'sfxRef'].some(key => key in record)
      )
        throw new Error(
          `${relative(root, source.file)}: Move presentation into data/presentations and resources into data/resources`,
        )
      if (source.kind !== 'presentations') continue
      try {
        const refs = validateBinding(record, sources)
        const target = JSON.stringify([record.target.kind, record.target.id])
        if (targets.has(target)) throw new Error(`Duplicate presentation target: ${target}`)
        targets.add(target)
        for (const ref of refs) if (typeof ref === 'string' && !ids.has(ref)) throw new Error(`Missing resource ${ref}`)
        const kindOf = ref => (typeof ref === 'string' ? kinds.get(ref) : undefined)
        const presentation = bindingPresentation(record)
        for (const [slot, ref] of Object.entries(presentation)) {
          if (slot === 'battle') {
            if (kindOf(ref.source) && kindOf(ref.source) !== (ref.renderer === 'image' ? 'image' : 'swf'))
              throw new Error('Battle resource type mismatch')
            if (kindOf(ref.fallback) && kindOf(ref.fallback) !== 'image') throw new Error('Fallback must be an image')
          } else if (kindOf(ref) && kindOf(ref) !== (['sfx', 'cry', 'music'].includes(slot) ? 'audio' : 'image'))
            throw new Error(`Resource type mismatch: ${slot}`)
        }
        bindings.push(record)
      } catch (error) {
        throw new Error(`${relative(root, source.file)}: ${error.message}`, { cause: error })
      }
    }
  const locales = {}
  for (const file of includeLocales ? await files(root, join(root, 'locales')) : []) {
    const path = relative(join(root, 'locales'), file).split('\\').join('/')
    const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9_-]+)\.(json|ya?ml)$/.exec(path)
    if (!match) throw new Error(`Expected locales/<language>/<namespace>.json|yaml: ${path}`)
    const [, language, namespace] = match
    const canonicalLanguage = Intl.getCanonicalLocales(language)[0]
    const text = await readFile(file, 'utf8')
    const value = match[3] === 'json' ? JSON.parse(text) : YAML.parse(text, { uniqueKeys: true, merge: true })
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
  return {
    version: 2,
    bindings: bindings.sort((a, b) => compare(a.id, b.id)),
    defaultLocale: 'zh-CN',
    resources: resources.sort((a, b) => compare(a.id, b.id)),
    locales,
  }
}
