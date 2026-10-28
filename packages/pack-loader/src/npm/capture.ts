import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { NpmProjectInspection } from './inspect'

const active = new Set<string>()
let listening = false

type Metadata = Record<string, unknown>
const object = (value: unknown): value is Metadata => !!value && typeof value === 'object' && !Array.isArray(value)

/** npm resolves lockfile sources relative to the project, but dependency declarations
 * relative to the declaring package. Preserve those origins in the private copy.
 */
async function relocateMetadata(root: string, source: string, installation: NpmProjectInspection) {
  const fileSource = (value: unknown, base: string) => {
    if (
      typeof value !== 'string' ||
      !value.startsWith('file:') ||
      isAbsolute(value.slice(5)) ||
      /^file:~(?:[/\\]|$)/.test(value)
    )
      return value
    return `file:${resolve(base, value.slice(5))}`
  }
  const declarations = (metadata: Metadata, base: string) => {
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const dependencies = metadata[field]
      if (object(dependencies))
        for (const name of Object.keys(dependencies)) dependencies[name] = fileSource(dependencies[name], base)
    }
  }
  const legacyDependencies = (dependencies: unknown) => {
    if (!object(dependencies)) return
    for (const entry of Object.values(dependencies)) {
      if (!object(entry)) continue
      for (const field of ['version', 'resolved']) entry[field] = fileSource(entry[field], source)
      legacyDependencies(entry.dependencies)
    }
  }
  const lockfile = (lock: Metadata) => {
    if (object(lock.packages))
      for (const [location, entry] of Object.entries(lock.packages)) {
        if (!object(entry)) continue
        if ('resolved' in entry) entry.resolved = fileSource(entry.resolved, source)
        declarations(entry, resolve(source, location))
      }
    legacyDependencies(lock.dependencies)
  }
  const rewrite = async (file: string, update: (metadata: Metadata) => void) => {
    let contents: string
    try {
      contents = await readFile(resolve(root, file), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    const metadata: unknown = JSON.parse(contents)
    if (!object(metadata)) return // The inspection retains responsibility for format errors.
    update(metadata)
    await writeFile(resolve(root, file), JSON.stringify(metadata))
  }
  await rewrite('package.json', metadata => declarations(metadata, source))
  for (const file of ['npm-shrinkwrap.json', 'package-lock.json', 'node_modules/.package-lock.json'])
    await rewrite(file, lockfile)
  for (const pkg of installation.packages)
    await rewrite(`${pkg.location}/package.json`, metadata => declarations(metadata, resolve(source, pkg.location)))
}

/** Keep package files used by lazy imports private to one prepared environment.
 * Only dependency inputs are copied; server credentials, saved games and workspace files are excluded.
 */
export async function captureNpmProject(source: string, installation: NpmProjectInspection) {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-npm-runtime-'))
  active.add(root)
  if (!listening) {
    listening = true
    process.once('exit', () => {
      for (const directory of active) {
        try {
          rmSync(directory, { recursive: true, force: true })
        } catch {
          /* OS temporary-directory cleanup remains available. */
        }
      }
    })
  }
  async function dispose() {
    await rm(root, { recursive: true, force: true })
    active.delete(root)
  }
  try {
    await cp(resolve(source, 'package.json'), resolve(root, 'package.json'))
    for (const file of ['npm-shrinkwrap.json', 'package-lock.json']) {
      try {
        await cp(resolve(source, file), resolve(root, file))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    await cp(resolve(source, 'node_modules'), resolve(root, 'node_modules'), {
      recursive: true,
      // Copy linked file contents too, so existing rooms do not follow later local edits.
      dereference: true,
    })
    await relocateMetadata(root, source, installation)
    return { root, dispose }
  } catch (error) {
    await dispose()
    throw error
  }
}
