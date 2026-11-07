#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import YAML from 'yaml'
import { AuthorWorkspace } from './workspace.mjs'
import { teamDocument } from './project-teams.mjs'
import { readContentSources } from './lib/content.mjs'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log('arcadia-content rename --name @your-scope/my-pack --project-id my-pack --namespace my-pack')
  process.exit(0)
}
const options = {}
for (let i = 0; i < args.length; i += 2) {
  if (
    !['--name', '--project-id', '--namespace'].includes(args[i]) ||
    options[args[i]] ||
    !args[i + 1] ||
    args[i + 1].startsWith('--')
  )
    throw new Error(`Unknown, duplicate or incomplete option: ${args[i]}`)
  options[args[i]] = args[i + 1]
}
if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(options['--name'] ?? '') || options['--name'].length > 214)
  throw new Error('Provide a lowercase npm package name.')
if (
  !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(options['--project-id'] ?? '') ||
  ['base', 'constructor', 'prototype'].includes(options['--project-id'])
)
  throw new Error('Provide a non-reserved project ID (1–80 letters, digits, dots, underscores or hyphens).')
if (!/^[a-z0-9][a-z0-9_.-]{0,79}$/.test(options['--namespace'] ?? '') || options['--namespace'] === 'base')
  throw new Error('Provide a non-reserved lowercase namespace (1–80 characters).')

const root = resolve('.')
const packagePath = resolve('package.json')
const manifest = JSON.parse(await readFile(packagePath, 'utf8'))
const oldId = manifest.arcadia.projectId
const oldNamespace = manifest.arcadia.namespace
const sources = await readContentSources(root)
const workspace = await AuthorWorkspace.open(root, { watch: false })
for (const { file } of await workspace.files()) {
  if (!/^debug\/teams\/[^/]+\.yaml$/.test(file)) continue
  const source = await workspace.read(file)
  const document = YAML.parseDocument(source.text)
  if (document.errors.length) throw document.errors[0]
  teamDocument(document.toJS())
  sources.push({ kind: 'project-team', file: resolve(file), document, version: source.version, relative: file })
}
function rewrite(value) {
  if (Array.isArray(value)) return value.map(rewrite)
  if (!value || typeof value !== 'object') return value
  const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)]))
  if (result.$ref?.projectId === oldId) result.$ref.projectId = options['--project-id']
  if (
    result.namespace === oldNamespace &&
    typeof result.id === 'string' &&
    Object.keys(result).every(key => ['namespace', 'id'].includes(key))
  )
    result.namespace = options['--namespace']
  return result
}
manifest.name = options['--name']
manifest.arcadia.projectId = options['--project-id']
manifest.arcadia.namespace = options['--namespace']
const changes = sources.map(source => {
  if (!source.document) return { file: source.file, text: JSON.stringify(rewrite(source.value), null, 2) + '\n' }
  // Detach alias uses before editing: an anchor may also supply an unrelated content ID.
  const aliases = new Map()
  YAML.visit(source.document, {
    Alias(_key, alias) {
      const replacement = source.document.createNode(alias.toJS(source.document), {
        aliasDuplicateObjects: false,
      })
      replacement.comment = alias.comment
      replacement.commentBefore = alias.commentBefore
      aliases.set(alias, replacement)
    },
  })
  YAML.visit(source.document, { Alias: (_key, alias) => aliases.get(alias) })
  YAML.visit(source.document, {
    Map(_key, node) {
      if (source.kind === 'project-team') {
        const update = value => {
          if (YAML.isScalar(value) && typeof value.value === 'string' && value.value.startsWith(`${oldNamespace}:`))
            value.value = options['--namespace'] + value.value.slice(oldNamespace.length)
        }
        for (const key of ['species', 'ability', 'emblem']) update(node.get(key, true))
        const skills = node.get('skills', true)
        if (YAML.isSeq(skills)) skills.items.forEach(update)
      }
      const namespace = node.get('namespace', true)
      if (YAML.isScalar(namespace) && namespace.value === oldNamespace && node.has('id') && node.items.length === 2)
        namespace.value = options['--namespace']
      const reference = node.get('$ref', true)
      if (!YAML.isMap(reference)) return
      const project = reference.get('projectId', true)
      if (YAML.isScalar(project) && project.value === oldId) project.value = options['--project-id']
    },
  })
  return { file: source.file, text: String(source.document), version: source.version, relative: source.relative }
})
await writeFile(packagePath, JSON.stringify(manifest, null, 2) + '\n')
for (const change of changes) {
  if (change.relative)
    await workspace.write({ file: change.relative, expectedVersion: change.version, text: change.text })
  else await writeFile(change.file, change.text)
}
await workspace.close()
console.log(
  `Renamed to ${manifest.name}. Update repository metadata before publishing. Keep projectId and namespace stable after sharing.`,
)
