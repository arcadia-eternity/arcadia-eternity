#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import YAML from 'yaml'
import { AuthorWorkspace } from './workspace.ts'
import { teamDocument } from './project-teams.ts'
import { readContentSources } from './lib/content.ts'
import type { Alias, Document, Node } from 'yaml'
import { isRecord } from './types.ts'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log('arcadia-content rename --name @your-scope/my-pack --project-id my-pack --namespace my-pack')
  process.exit(0)
}
type RenameOption = '--name' | '--project-id' | '--namespace'
const options: Partial<Record<RenameOption, string>> = {}
for (let i = 0; i < args.length; i += 2) {
  const option = args[i] as RenameOption
  if (
    !['--name', '--project-id', '--namespace'].includes(option) ||
    options[option] ||
    !args[i + 1] ||
    args[i + 1].startsWith('--')
  )
    throw new Error(`Unknown, duplicate or incomplete option: ${args[i]}`)
  options[option] = args[i + 1]
}
const name = options['--name'] ?? ''
const projectId = options['--project-id'] ?? ''
const newNamespace = options['--namespace'] ?? ''
if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name) || name.length > 214)
  throw new Error('Provide a lowercase npm package name.')
if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(projectId) || ['base', 'constructor', 'prototype'].includes(projectId))
  throw new Error('Provide a non-reserved project ID (1–80 letters, digits, dots, underscores or hyphens).')
if (!/^[a-z0-9][a-z0-9_.-]{0,79}$/.test(newNamespace) || newNamespace === 'base')
  throw new Error('Provide a non-reserved lowercase namespace (1–80 characters).')

const root = resolve('.')
const packagePath = resolve('package.json')
const manifest = JSON.parse(await readFile(packagePath, 'utf8')) as {
  name?: string
  arcadia: { projectId?: string; namespace?: string; [key: string]: unknown }
  [key: string]: unknown
}
const oldId = manifest.arcadia.projectId
const oldNamespace = manifest.arcadia.namespace
const sources: Array<{
  kind: string
  file: string
  text?: string
  document?: Document
  value?: unknown
  version?: string
  relative?: string
}> = await readContentSources(root)
const workspace = await AuthorWorkspace.open(root, { watch: false })
for (const { file } of await workspace.files()) {
  if (!/^debug\/teams\/[^/]+\.yaml$/.test(file)) continue
  const source = await workspace.read(file)
  const document = YAML.parseDocument(source.text)
  if (document.errors.length) throw document.errors[0]
  teamDocument(document.toJS())
  sources.push({ kind: 'project-team', file, document, version: source.version, relative: file })
}
function rewrite(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewrite)
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, rewrite(child)]),
  )
  const reference = result.$ref
  if (isRecord(reference) && reference.projectId === oldId) reference.projectId = projectId
  if (
    result.namespace === oldNamespace &&
    typeof result.id === 'string' &&
    Object.keys(result).every(key => ['namespace', 'id'].includes(key))
  )
    result.namespace = newNamespace
  return result
}
manifest.name = name
manifest.arcadia.projectId = projectId
manifest.arcadia.namespace = newNamespace
const changes = sources.map(source => {
  if (!source.document) return { file: source.file, text: JSON.stringify(rewrite(source.value), null, 2) + '\n' }
  const document = source.document
  // Detach alias uses before editing: an anchor may also supply an unrelated content ID.
  const aliases = new Map<Alias, Node>()
  YAML.visit(document, {
    Alias(_key, alias) {
      const replacement = document.createNode(alias.toJS(document), {
        aliasDuplicateObjects: false,
      })
      replacement.comment = alias.comment
      replacement.commentBefore = alias.commentBefore
      aliases.set(alias, replacement)
    },
  })
  YAML.visit(document, {
    Alias: (_key, alias) => {
      const replacement = aliases.get(alias)
      if (replacement) return replacement
    },
  })
  YAML.visit(document, {
    Map(_key, node) {
      if (source.kind === 'project-team') {
        const update = (value: unknown) => {
          if (YAML.isScalar(value) && typeof value.value === 'string' && value.value.startsWith(`${oldNamespace}:`))
            value.value = newNamespace + value.value.slice((oldNamespace ?? '').length)
        }
        for (const key of ['species', 'ability', 'emblem']) update(node.get(key, true))
        const skills = node.get('skills', true)
        if (YAML.isSeq(skills)) skills.items.forEach(update)
      }
      const namespaceNode = node.get('namespace', true)
      if (
        YAML.isScalar(namespaceNode) &&
        namespaceNode.value === oldNamespace &&
        node.has('id') &&
        node.items.length === 2
      )
        namespaceNode.value = newNamespace
      const reference = node.get('$ref', true)
      if (!YAML.isMap(reference)) return
      const project = reference.get('projectId', true)
      if (YAML.isScalar(project) && project.value === oldId) project.value = projectId
    },
  })
  return { file: source.file, text: String(document), version: source.version, relative: source.relative }
})
await writeFile(packagePath, JSON.stringify(manifest, null, 2) + '\n')
for (const change of changes) {
  if (change.relative && change.version)
    await workspace.write({ file: change.relative, expectedVersion: change.version, text: change.text })
  else await writeFile(change.file, change.text)
}
await workspace.close()
console.log(
  `Renamed to ${manifest.name}. Update repository metadata before publishing. Keep projectId and namespace stable after sharing.`,
)
