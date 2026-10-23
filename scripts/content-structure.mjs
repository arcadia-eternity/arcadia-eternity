import { readFile, writeFile, mkdir, rm, lstat, link, rename } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import YAML from 'yaml'

const kinds = ['species', 'skills', 'marks']
const sorted = values => [...values].sort()
const exists = async path => {
  try {
    return await lstat(path)
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}
function inside(root, path) {
  const result = resolve(root, path)
  const local = relative(root, result)
  if (!local || isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`))
    throw new Error(`Path must stay inside the pack: ${path}`)
  return result
}
async function plainFile(root, path) {
  const full = inside(root, path)
  for (let current = full; current !== root; current = dirname(current)) {
    const stat = await exists(current)
    if (stat?.isSymbolicLink()) throw new Error(`Symlink is not a migration target: ${path}`)
  }
  return full
}
const relativeFile = (root, path) => relative(root, path).split(sep).join('/')
function parseYaml(text, file) {
  const document = YAML.parseDocument(text, { merge: true })
  if (document.errors.length) throw new Error(`Invalid YAML ${file}: ${document.errors[0].message}`)
  return document
}

/** Read editable metadata only. Effect code is never generated or evaluated by this tool. */
export async function inventoryContent({ pack, groups, effectIds }) {
  const packPath = resolve(pack)
  const root = dirname(packPath)
  const manifestText = await readFile(packPath, 'utf8')
  const manifest = JSON.parse(manifestText)
  const dataRoot = inside(root, manifest.paths?.dataDir ?? 'data')
  const groupText = await readFile(groups, 'utf8')
  const config = parseYaml(groupText, groups).toJS()
  if (config?.formatVersion !== 1 || !Array.isArray(config.groups)) throw new Error('Invalid content group config')
  const groupIds = new Set()
  const speciesOwners = new Map()
  for (const group of config.groups) {
    if (!/^[a-z][a-z0-9_-]*$/.test(group.id) || groupIds.has(group.id) || !Array.isArray(group.species))
      throw new Error(`Invalid or duplicate group: ${group.id}`)
    groupIds.add(group.id)
    for (const id of group.species) {
      if (typeof id !== 'string' || speciesOwners.has(id))
        throw new Error(`Duplicate or invalid grouped species: ${id}`)
      speciesOwners.set(id, group.id)
    }
  }
  const owners = Object.fromEntries([...kinds, 'effects'].map(kind => [kind, new Map()]))
  owners.species = speciesOwners
  for (const kind of ['skills', 'marks', 'effects']) {
    const entries = config.owners?.[kind] ?? {}
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error(`Invalid owners.${kind}`)
    for (const [id, group] of Object.entries(entries)) {
      if (!groupIds.has(group)) throw new Error(`Unknown owner group ${group} for ${id}`)
      owners[kind].set(id, group)
    }
  }
  const records = Object.fromEntries(kinds.map(kind => [kind, []]))
  const indexes = Object.fromEntries(kinds.map(kind => [kind, new Map()]))
  const files = []
  const seenPaths = new Set()
  const diagnostics = []
  for (const kind of kinds) {
    if (!Array.isArray(manifest.data?.[kind])) throw new Error(`Missing manifest data.${kind}`)
    for (const file of manifest.data[kind]) {
      if (typeof file !== 'string') throw new Error(`Invalid metadata path: ${kind}`)
      const path = inside(dataRoot, file)
      const local = relativeFile(root, path)
      if (seenPaths.has(path)) throw new Error(`Metadata file listed more than once: ${local}`)
      seenPaths.add(path)
      await plainFile(root, local)
      const before = await readFile(path, 'utf8')
      const document = parseYaml(before, local)
      if (!YAML.isSeq(document.contents)) throw new Error(`Expected metadata array: ${local}`)
      const values = document.toJS()
      const source = { kind, file, path: local, before, document, records: [] }
      values.forEach((value, position) => {
        if (!value || typeof value.id !== 'string' || !value.id)
          throw new Error(`Missing ${kind} ID: ${local}[${position}]`)
        const record = { id: value.id, kind, file: local, position, value, owner: owners[kind].get(value.id) ?? null }
        if (indexes[kind].has(value.id)) diagnostics.push({ code: 'duplicate-id', kind, id: value.id, file: local })
        else indexes[kind].set(value.id, record)
        source.records.push(record)
        records[kind].push(record)
      })
      files.push(source)
    }
    for (const id of owners[kind].keys())
      if (!indexes[kind].has(id)) diagnostics.push({ code: 'unknown-owner-id', kind, id })
  }
  const effectCatalog = effectIds === undefined ? undefined : new Set(effectIds)
  if (effectCatalog && effectCatalog.size !== effectIds.length) throw new Error('Duplicate effect catalog ID')
  for (const id of owners.effects.keys())
    if (effectCatalog && !effectCatalog.has(id)) diagnostics.push({ code: 'unknown-owner-id', kind: 'effects', id })
  const references = []
  const add = (from, targetKind, targetId, field) => {
    if (typeof targetId !== 'string' || !targetId) throw new Error(`Invalid reference: ${from.id}.${field}`)
    references.push({ fromKind: from.kind, from: from.id, toKind: targetKind, to: targetId, field })
    const known = targetKind === 'effects' ? effectCatalog : indexes[targetKind]
    if (known && !known.has(targetId))
      diagnostics.push({ code: 'missing-reference', from: from.id, kind: targetKind, id: targetId, field })
  }
  for (const record of records.species) {
    for (const [index, skill] of (record.value.learnable_skills ?? []).entries())
      add(record, 'skills', skill.skill_id, `learnable_skills[${index}].skill_id`)
    for (const field of ['ability', 'emblem'])
      for (const [index, id] of (record.value[field] ?? []).entries()) add(record, 'marks', id, `${field}[${index}]`)
  }
  for (const kind of ['skills', 'marks'])
    for (const record of records[kind])
      for (const [index, id] of (record.value.effect ?? []).entries()) add(record, 'effects', id, `effect[${index}]`)

  // Reachability is evidence for a placement proposal, never an ownership decision.
  const consumers = new Map()
  const unresolvedConsumers = new Set()
  const candidates = []
  const sourceGroups = (kind, id) => {
    const owner = owners[kind].get(id)
    return owner ? [owner] : [...(consumers.get(`${kind}:${id}`) ?? [])]
  }
  for (const kind of ['species', 'skills', 'marks']) {
    for (const edge of references.filter(edge => edge.fromKind === kind)) {
      const key = `${edge.toKind}:${edge.to}`
      const set = consumers.get(key) ?? new Set()
      const groups = sourceGroups(edge.fromKind, edge.from)
      for (const group of groups) set.add(group)
      if (
        !groups.length ||
        (!owners[edge.fromKind].has(edge.from) && unresolvedConsumers.has(`${edge.fromKind}:${edge.from}`))
      )
        unresolvedConsumers.add(key)
      consumers.set(key, set)
    }
  }
  const effectRefs = new Set(references.filter(edge => edge.toKind === 'effects').map(edge => edge.to))
  for (const kind of ['skills', 'marks', 'effects']) {
    const ids = kind === 'effects' ? (effectCatalog ?? effectRefs) : indexes[kind].keys()
    for (const id of ids) {
      if (owners[kind].has(id)) continue
      const key = `${kind}:${id}`
      const groups = sorted(consumers.get(key) ?? [])
      candidates.push({
        kind,
        id,
        groups,
        status: unresolvedConsumers.has(key)
          ? 'unresolved-consumers'
          : groups.length === 1
            ? 'exclusive-candidate'
            : groups.length
              ? 'multiple-groups'
              : 'unreferenced',
      })
    }
  }
  const crossGroupReferences = references.filter(edge => {
    const from = owners[edge.fromKind].get(edge.from)
    const to = owners[edge.toKind].get(edge.to)
    return from && to && from !== to
  })
  const summary = {
    counts: {
      ...Object.fromEntries(kinds.map(kind => [kind, records[kind].length])),
      effects: effectCatalog?.size ?? null,
    },
    groups: groupIds.size,
    references: references.length,
    referencedEffects: effectRefs.size,
    effectReferencesChecked: effectCatalog !== undefined,
    explicitOwners: Object.fromEntries([...kinds, 'effects'].map(kind => [kind, owners[kind].size])),
    candidates: Object.fromEntries(
      ['exclusive-candidate', 'multiple-groups', 'unresolved-consumers', 'unreferenced'].map(status => [
        status,
        candidates.filter(item => item.status === status).length,
      ]),
    ),
    crossGroupReferences: crossGroupReferences.length,
    errors: diagnostics.length,
  }
  return {
    root,
    packPath,
    manifest,
    manifestText,
    dataRoot,
    files,
    records,
    owners,
    references,
    candidates,
    crossGroupReferences,
    diagnostics,
    summary,
  }
}

function detachedNode(node, document, ancestors = new Set()) {
  if (YAML.isAlias(node)) {
    const target = node.resolve(document)
    if (!target || ancestors.has(target)) throw new Error('Cannot split unresolved or cyclic YAML aliases')
    const next = new Set(ancestors).add(target)
    const replacement = detachedNode(target, document, next)
    if (node.comment) replacement.comment = node.comment
    if (node.commentBefore) replacement.commentBefore = node.commentBefore
    return replacement
  }
  if (!node || typeof node !== 'object') return node
  const result = node.clone()
  delete result.anchor
  if (YAML.isCollection(result)) {
    result.items = node.items.map(item => {
      if (YAML.isPair(item))
        return new YAML.Pair(detachedNode(item.key, document, ancestors), detachedNode(item.value, document, ancestors))
      return detachedNode(item, document, ancestors)
    })
  }
  return result
}

/** A source moves only when every row has a confirmed owner; other sources remain authoritative in place. */
export function planContentStructure(inventory) {
  if (inventory.diagnostics.length)
    throw new Error(`Inventory has ${inventory.diagnostics.length} error(s); resolve them before planning`)
  const { root, files, manifestText, packPath, dataRoot } = inventory
  const manifest = structuredClone(inventory.manifest)
  const inputs = [{ path: relativeFile(root, packPath), before: manifestText }]
  const writes = []
  const removals = []
  const deferred = []
  const sequence = Object.fromEntries(kinds.map(kind => [kind, 0]))
  // Existing chunks keep their names when an earlier deferred source is admitted later.
  const placed = new Map()
  for (const source of files) {
    const match = source.file.match(new RegExp(`^groups/([^/]+)/${source.kind}\\.(\\d+)\\.yaml$`))
    if (match) {
      placed.set(source.path, match[1])
      sequence[source.kind] = Math.max(sequence[source.kind], Number(match[2]) + 1)
    }
  }
  const taken = new Set()
  for (const kind of kinds) {
    const outputFiles = []
    for (const source of files.filter(file => file.kind === kind)) {
      inputs.push({ path: source.path, before: source.before })
      const unresolved = source.records.filter(record => !record.owner).map(record => record.id)
      if (unresolved.length || !source.records.length) {
        outputFiles.push(source.file)
        if (unresolved.length) deferred.push({ path: source.path, kind, unresolved })
        continue
      }
      if (source.records.every(record => record.owner === placed.get(source.path))) {
        outputFiles.push(source.file)
        continue
      }
      const runs = []
      for (const record of source.records) {
        const previous = runs.at(-1)
        if (previous?.owner === record.owner) previous.records.push(record)
        else runs.push({ owner: record.owner, records: [record] })
      }
      const recovered = []
      for (const run of runs) {
        const suffix = String(sequence[kind]++).padStart(4, '0')
        const file = `groups/${run.owner}/${kind}.${suffix}.yaml`
        const path = relativeFile(root, inside(dataRoot, file))
        if (taken.has(path)) throw new Error(`Duplicate destination: ${path}`)
        taken.add(path)
        const document = source.document.clone()
        document.contents.items = run.records.map(record =>
          detachedNode(source.document.contents.items[record.position], source.document),
        )
        const content = document.toString({ lineWidth: 0 })
        recovered.push(...parseYaml(content, path).toJS())
        writes.push({ path, content })
        outputFiles.push(file)
      }
      if (
        !isDeepStrictEqual(
          recovered,
          source.records.map(record => record.value),
        )
      )
        throw new Error(`Splitting changed metadata: ${source.path}`)
      removals.push(source.path)
    }
    manifest.data[kind] = outputFiles
  }
  const sourcePaths = new Set(files.map(file => file.path))
  for (const output of writes)
    if (sourcePaths.has(output.path) && !removals.includes(output.path))
      throw new Error(`Destination collides with retained source: ${output.path}`)
  const manifestPath = relativeFile(root, packPath)
  const manifestAfter = JSON.stringify(manifest, null, 2) + '\n'
  return {
    formatVersion: 1,
    manifest: manifestPath,
    summary: { ...inventory.summary, outputFiles: writes.length, deferredFiles: deferred.length },
    inputs,
    writes: [...writes, { path: manifestPath, content: manifestAfter }],
    removals: removals.filter(path => !taken.has(path)),
    deferred,
  }
}

/** Apply an exact reviewed plan. Unrelated existing files and changed inputs are never overwritten. */
export async function applyContentStructure(root, plan) {
  root = resolve(root)
  if (
    plan.formatVersion !== 1 ||
    !Array.isArray(plan.inputs) ||
    !Array.isArray(plan.writes) ||
    !Array.isArray(plan.removals)
  )
    throw new Error('Invalid content structure plan')
  const expected = new Map(plan.inputs.map(input => [input.path, input.before]))
  const outputs = new Map(plan.writes.map(output => [output.path, output.content]))
  if (expected.size !== plan.inputs.length || outputs.size !== plan.writes.length || !outputs.has(plan.manifest))
    throw new Error('Duplicate or missing plan paths')
  if (plan.removals.some(path => !expected.has(path) || outputs.has(path))) throw new Error('Invalid removal in plan')
  for (const path of new Set([...expected.keys(), ...outputs.keys(), ...plan.removals])) await plainFile(root, path)
  const read = async path => ((await exists(inside(root, path))) ? readFile(inside(root, path), 'utf8') : undefined)
  const outputMatches = await Promise.all([...outputs].map(async ([path, text]) => (await read(path)) === text))
  const applied = outputMatches.every(Boolean)
  if (applied) {
    for (const path of plan.removals) {
      const current = await read(path)
      if (current !== undefined && current !== expected.get(path)) throw new Error(`Changed retired source: ${path}`)
    }
    for (const path of plan.removals) await rm(inside(root, path), { force: true })
    return { changed: false, files: outputs.size - 1 }
  }
  for (const [path, text] of expected)
    if ((await read(path)) !== text) throw new Error(`Input changed since planning: ${path}`)
  for (const [path, text] of outputs) {
    const current = await read(path)
    if (current !== undefined && current !== text && !expected.has(path))
      throw new Error(`Refusing to overwrite unrelated file: ${path}`)
  }
  const staged = []
  const created = []
  let manifestCommitted = false
  try {
    for (const [path, text] of outputs) {
      if ((await read(path)) === text) continue
      const destination = inside(root, path)
      await mkdir(dirname(destination), { recursive: true })
      const temporary = `${destination}.migration-${process.pid}-${staged.length}`
      await writeFile(temporary, text, { flag: 'wx' })
      staged.push({ path, destination, temporary })
    }
    for (const [path, text] of expected)
      if ((await read(path)) !== text) throw new Error(`Input changed while staging: ${path}`)
    for (const item of staged.filter(item => item.path !== plan.manifest)) {
      if (expected.has(item.path)) throw new Error(`Plan would rewrite an existing metadata source: ${item.path}`)
      await link(item.temporary, item.destination)
      created.push(item.destination)
    }
    const commit = staged.find(item => item.path === plan.manifest)
    if (commit) await rename(commit.temporary, commit.destination)
    manifestCommitted = true
    for (const path of plan.removals)
      if ((await read(path)) !== expected.get(path)) throw new Error(`Changed retired source: ${path}`)
    for (const path of plan.removals) {
      await rm(inside(root, path))
    }
    return { changed: true, files: outputs.size - 1 }
  } catch (error) {
    if (!manifestCommitted) await Promise.all(created.map(path => rm(path, { force: true })))
    throw error
  } finally {
    await Promise.all(staged.map(item => rm(item.temporary, { force: true })))
  }
}

async function main(argv) {
  const [command = 'inventory', ...args] = argv
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!['--pack', '--groups', '--effects', '--out', '--plan', '--root'].includes(args[i]) || !args[i + 1])
      throw new Error(`Unknown or incomplete option: ${args[i]}`)
    options[args[i].slice(2)] = args[i + 1]
  }
  if (command === 'apply') {
    if (!options.plan || !options.root) throw new Error('apply requires --plan and --root')
    console.log(
      JSON.stringify(
        await applyContentStructure(options.root, JSON.parse(await readFile(options.plan, 'utf8'))),
        null,
        2,
      ),
    )
    return
  }
  if (!['inventory', 'plan'].includes(command)) throw new Error(`Unknown command: ${command}`)
  const inventory = await inventoryContent({
    pack: options.pack ?? 'packs/base/pack.json',
    groups: options.groups ?? 'packs/base/content-groups.yaml',
    effectIds: options.effects ? JSON.parse(await readFile(options.effects, 'utf8')) : undefined,
  })
  const result =
    command === 'plan'
      ? planContentStructure(inventory)
      : {
          summary: inventory.summary,
          diagnostics: inventory.diagnostics,
          resources: kinds.flatMap(kind =>
            inventory.records[kind].map(({ id, file, position, owner }) => ({ kind, id, file, position, owner })),
          ),
          candidates: inventory.candidates,
          crossGroupReferences: inventory.crossGroupReferences,
          references: inventory.references,
        }
  if (options.out) await writeFile(options.out, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
  console.log(
    JSON.stringify(
      { ...result.summary, ...(inventory.diagnostics.length ? { diagnostics: inventory.diagnostics } : {}) },
      null,
      2,
    ),
  )
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
