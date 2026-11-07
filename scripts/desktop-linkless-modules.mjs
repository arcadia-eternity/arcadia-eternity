import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const within = (root, path) => {
  const value = relative(root, path)
  return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value))
}
const packageName = name => {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i.test(name)) throw new Error(`Invalid package name: ${name}`)
  return name
}

/** Windows ZIP/NSIS dereference directory links, which destroys pnpm's sibling
 * dependency lookup. Reuse Builder's locked hoister to project the already
 * staged graph into ordinary directories, without resolving or downloading
 * packages. Verify every dependency edge against its original physical package.
 * source and destination are separate, exclusively owned staging directories.
 */
export async function materializeLinklessModules(source, destination) {
  if (!(await lstat(source)).isDirectory()) throw new Error('Source modules must be a physical directory')
  const root = await realpath(source)
  if (within(root, resolve(destination))) throw new Error('Destination must be outside source modules')
  const webRequire = createRequire(new URL('../packages/web-ui/package.json', import.meta.url))
  const builderRequire = createRequire(webRequire.resolve('electron-builder/package.json'))
  const { hoist } = builderRequire('app-builder-lib/out/node-module-collector/hoist.js')
  const records = new Map(),
    nodes = new Map()
  async function locate(directory, name) {
    packageName(name)
    for (let current = directory; within(root, current); current = dirname(current)) {
      if (current !== root && current.endsWith(`${sep}node_modules`)) continue
      const candidate = join(current === root ? current : join(current, 'node_modules'), ...name.split('/'))
      let physical
      try {
        physical = await realpath(candidate)
      } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
      if (!within(root, physical)) throw new Error(`Dependency escapes staged modules: ${name}`)
      return physical
    }
  }
  async function visit(name, directory) {
    const reference = createHash('sha256').update(relative(root, directory)).digest('hex')
    const key = `${name}@${reference}`
    if (nodes.has(key)) return nodes.get(key)
    if (nodes.size >= 10000) throw new Error('Staged dependency graph exceeds limit')
    const bytes = await readFile(join(directory, 'package.json'))
    const pkg = JSON.parse(bytes)
    const node = { name: packageName(name), identName: name, reference, dependencies: new Set(), peerNames: new Set() }
    nodes.set(key, node)
    const record = { directory, bytes, edges: new Map() }
    records.set(reference, record)
    const dependencies = { ...pkg.peerDependencies, ...pkg.dependencies, ...pkg.optionalDependencies }
    for (const dependency of Object.keys(dependencies).sort()) {
      const optional =
        dependency in (pkg.optionalDependencies ?? {}) ||
        (!(dependency in (pkg.dependencies ?? {})) && pkg.peerDependenciesMeta?.[dependency]?.optional === true)
      const target = await locate(directory, dependency)
      if (!target) {
        if (optional) continue
        throw new Error(`Missing staged dependency: ${name} -> ${dependency}`)
      }
      const child = await visit(dependency, target)
      record.edges.set(dependency, child.reference)
      node.dependencies.add(child)
      // pnpm has already selected each peer instance in this package's own
      // lookup scope. Preserve that resolved edge just like a normal dependency;
      // do not ask a second package manager to select it from the new parent.
    }
    return node
  }
  const graph = { name: '.', identName: '.', reference: '.', dependencies: new Set(), peerNames: new Set() }
  for (const entry of (await readdir(root)).sort()) {
    if (entry.startsWith('.')) continue
    const names = entry.startsWith('@')
      ? (await readdir(join(root, entry))).sort().map(name => `${entry}/${name}`)
      : [entry]
    for (const name of names) {
      const target = await locate(root, name)
      if (!target) throw new Error(`Missing root dependency: ${name}`)
      graph.dependencies.add(await visit(name, target))
    }
  }
  const tree = hoist(graph, { check: true })
  await mkdir(destination) // Never merge into an existing/foreign directory.
  const output = await realpath(destination),
    placements = new Map()
  async function copy(dependencies, modules) {
    for (const node of dependencies) {
      if (node.references.size !== 1) throw new Error('Hoister merged distinct physical dependency instances')
      const reference = [...node.references][0],
        record = records.get(reference)
      if (!record) throw new Error('Hoister returned an unknown dependency')
      const target = join(modules, ...packageName(node.name).split('/'))
      await cp(record.directory, target, {
        recursive: true,
        dereference: true,
        force: false,
        errorOnExist: true,
        filter: async path => {
          if (path === join(record.directory, 'node_modules')) return false
          if (!within(record.directory, await realpath(path)))
            throw new Error('Package content link escapes its package')
          return true
        },
      })
      placements.set(target, reference)
      if (node.dependencies.size) await copy(node.dependencies, join(target, 'node_modules'))
    }
  }
  await copy(tree.dependencies, output)
  let edges = 0
  for (const [path, reference] of placements) {
    const record = records.get(reference)
    if (!(await readFile(join(path, 'package.json'))).equals(record.bytes)) throw new Error('Package manifest changed')
    for (const [name, expected] of record.edges) {
      let actual
      for (let current = path; within(output, current); current = dirname(current)) {
        const candidate = join(current === output ? current : join(current, 'node_modules'), ...name.split('/'))
        if (placements.has(candidate)) {
          actual = placements.get(candidate)
          break
        }
      }
      if (actual !== expected)
        throw new Error(`Dependency identity changed after hoisting: ${relative(output, path)} -> ${name}`)
      edges++
    }
  }
  return { packages: placements.size, edges }
}
