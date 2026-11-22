import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { errorCode } from './types.ts'

const within = (root: string, path: string) => path === root || path.startsWith(root + sep)

async function installedPath(path: string) {
  try {
    return await realpath(path)
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
    return undefined
  }
}

// Linux Desktop stages a relocatable pnpm tree. Copy each reachable physical package
// once and preserve its actual dependency identities (including aliases and peers).
async function copySdkModules(modules: string, output: string, roots: string[]) {
  const seen = new Set<string>()
  async function copyPackage(source: string) {
    if (!within(modules, source)) throw new Error('SDK dependency outside the AppImage: ' + source)
    if (seen.has(source)) return
    seen.add(source)
    const target = join(output, relative(modules, source))
    await cp(source, target, {
      recursive: true,
      verbatimSymlinks: true,
      filter: file => file !== join(source, 'node_modules'),
    })
    const file = join(source, 'package.json')
    const pkg = JSON.parse(await readFile(file, 'utf8'))
    const loader = createRequire(file)
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })) {
      if (!/^(?:@[\w.-]+\/)?[\w-][\w.-]*$/.test(name)) throw new Error('Invalid SDK dependency name: ' + name)
      let dependency
      for (const directory of loader.resolve.paths(name) ?? []) {
        if (!within(modules, directory)) continue
        dependency = await installedPath(join(directory, name))
        if (dependency) break
      }
      if (!dependency) {
        if (name in (pkg.optionalDependencies ?? {}) || pkg.peerDependenciesMeta?.[name]?.optional) continue
        throw new Error('Bundled SDK dependency missing: ' + name)
      }
      await copyPackage(dependency)
      const link = join(target, 'node_modules', name)
      const resolvedTarget = join(output, relative(modules, dependency))
      if (link === resolvedTarget) continue
      await mkdir(dirname(link), { recursive: true })
      await symlink(relative(dirname(link), resolvedTarget), link)
    }
  }
  for (const root of roots) await copyPackage(root)
}

/** Connect project links to durable packages only for an SDK loaded from a mounted AppImage. */
export async function persistentSdkPackages(packages: Record<string, string>, env = process.env) {
  const { APPDIR, APPIMAGE, XDG_DATA_HOME } = env
  if (!APPDIR || !isAbsolute(APPDIR) || !APPIMAGE || !isAbsolute(APPIMAGE)) return packages
  const sdk = packages['@arcadia-eternity/content-sdk']
  const modules = await installedPath(join(APPDIR, 'resources/arcadia-server/node_modules'))
  if (!modules || resolve(sdk) !== join(modules, '@arcadia-eternity/content-sdk')) return packages
  const image = await stat(APPIMAGE, { bigint: true })
  const key = createHash('sha256').update([image.dev, image.ino, image.size, image.ctimeNs].join('/')).digest('hex')
  const data = XDG_DATA_HOME && isAbsolute(XDG_DATA_HOME) ? XDG_DATA_HOME : join(homedir(), '.local/share')
  const directory = join(data, 'arcadia-eternity/author-sdks')
  const destination = join(directory, key)
  const durable = Object.fromEntries(
    Object.entries(packages).map(([name, path]) => [name, join(destination, 'node_modules', relative(modules, path))]),
  )
  try {
    if (!(await lstat(destination)).isDirectory()) throw new Error('Invalid cached AppImage SDK: ' + destination)
    return durable
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const staging = await mkdtemp(join(directory, '.staging-'))
  try {
    const roots = [...Object.values(packages).map(path => resolve(path))]
    const base = await installedPath(join(modules, '@arcadia-eternity/data-pack-base'))
    if (base) roots.push(base)
    await copySdkModules(modules, join(staging, 'node_modules'), roots)
    try {
      await rename(staging, destination)
    } catch (error) {
      // Another connection may have published the complete, non-empty directory first.
      if (!['EEXIST', 'ENOTEMPTY'].includes(errorCode(error) ?? '')) throw error
    }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
  return durable
}
