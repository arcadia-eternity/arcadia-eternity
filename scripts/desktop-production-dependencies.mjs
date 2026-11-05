import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const testPackages = new Set(['vitest', 'why-is-node-running', 'stackback'])

function invalid(code, message) {
  return Object.assign(new Error(message), { code })
}

/** Verify the physical production graph without following dependency symlinks.
 * The runtime layout validator separately checks link containment/relocation.
 */
export async function verifyDesktopProductionDependencies(root) {
  if (typeof root !== 'string' || !root)
    throw invalid('DESKTOP_DEPENDENCIES_INVALID', 'A runtime directory is required')
  const requested = resolve(root)
  const info = await lstat(requested)
  if (!info.isDirectory() || info.isSymbolicLink())
    throw invalid('DESKTOP_DEPENDENCIES_INVALID', 'Runtime root must be a physical directory')
  // Resolve ancestor aliases such as macOS /tmp without allowing the root
  // itself to redirect the audit to a different runtime.
  const directory = await realpath(requested)

  async function modules(path, required = false) {
    const info = await lstat(path).catch(error => {
      if (!required && error.code === 'ENOENT') return undefined
      throw error
    })
    if (!info) return
    if (!info.isDirectory() || info.isSymbolicLink())
      throw invalid('DESKTOP_DEPENDENCIES_INVALID', `Expected physical node_modules: ${relative(directory, path)}`)
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.name === '.pnpm' && entry.isSymbolicLink())
        throw invalid(
          'DESKTOP_DEPENDENCIES_INVALID',
          `Expected physical pnpm store: ${relative(directory, join(path, entry.name))}`,
        )
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue
      const child = join(path, entry.name)
      if (entry.name === '.pnpm') {
        for (const store of await readdir(child, { withFileTypes: true })) {
          if (store.isSymbolicLink() || !store.isDirectory()) continue
          if (store.name === 'node_modules') await modules(join(child, store.name))
          else if (!store.name.startsWith('.')) await modules(join(child, store.name, 'node_modules'))
        }
      } else if (entry.name.startsWith('@')) {
        for (const scoped of await readdir(child, { withFileTypes: true }))
          if (scoped.isDirectory() && !scoped.isSymbolicLink()) await installedPackage(join(child, scoped.name))
      } else if (!entry.name.startsWith('.')) await installedPackage(child)
    }
  }

  async function installedPackage(path) {
    const manifestPath = join(path, 'package.json')
    const info = await lstat(manifestPath)
    if (!info.isFile() || info.isSymbolicLink())
      throw invalid(
        'DESKTOP_DEPENDENCIES_INVALID',
        `Expected physical package manifest: ${relative(directory, manifestPath)}`,
      )
    const pkg = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (typeof pkg.name !== 'string' || !pkg.name)
      throw invalid('DESKTOP_DEPENDENCIES_INVALID', `Package name is missing: ${relative(directory, manifestPath)}`)
    if (testPackages.has(pkg.name))
      throw invalid(
        'DESKTOP_TEST_DEPENDENCY',
        `Test dependency in desktop runtime: ${pkg.name}@${pkg.version ?? 'unknown'} (${relative(directory, path)})`,
      )
    await modules(join(path, 'node_modules'))
  }

  await modules(join(directory, 'node_modules'), true)
  const bundled = join(directory, 'runtime')
  const runtimeInfo = await lstat(bundled).catch(error => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (runtimeInfo) {
    if (!runtimeInfo.isDirectory() || runtimeInfo.isSymbolicLink())
      throw invalid('DESKTOP_DEPENDENCIES_INVALID', 'Bundled runtime must be a physical directory')
    const npm = join(bundled, 'npm')
    const npmInfo = await lstat(npm).catch(error => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (npmInfo) {
      if (!npmInfo.isDirectory() || npmInfo.isSymbolicLink())
        throw invalid('DESKTOP_DEPENDENCIES_INVALID', 'Bundled npm must be a physical package directory')
      await installedPackage(npm)
    }
  }
}
