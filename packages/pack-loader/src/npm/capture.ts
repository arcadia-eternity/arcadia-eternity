import { cp, mkdtemp, rm } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const active = new Set<string>()
let listening = false

/** Keep package files used by lazy imports private to one prepared environment.
 * Only dependency inputs are copied; server credentials, saved games and workspace files are excluded.
 */
export async function captureNpmProject(source: string) {
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
    return { root, dispose }
  } catch (error) {
    await dispose()
    throw error
  }
}
