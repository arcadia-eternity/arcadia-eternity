import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { registryIdPattern } from './metadata'
import type { WorkshopTrustState, WorkshopTrustStore } from './client'

/** Holds `<file>.lock` across processes. A lock whose owner process has exited is reclaimed. */
async function withFileLock<T>(file: string, run: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
  const lock = file + '.lock'
  const deadline = Date.now() + timeoutMs
  for (let wait = 5; ; wait = Math.min(wait * 2, 200)) {
    try {
      const handle = await open(lock, 'wx', 0o600)
      try {
        await handle.writeFile(String(process.pid))
      } finally {
        await handle.close()
      }
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const owner = Number(await readFile(lock, 'utf8').catch(() => ''))
      let alive = true
      if (Number.isSafeInteger(owner) && owner > 0)
        try {
          process.kill(owner, 0)
        } catch (probe) {
          alive = (probe as NodeJS.ErrnoException).code !== 'ESRCH'
        }
      // Only a recorded, exited owner is reclaimed; an empty file may still be mid-write by a live owner.
      if (!alive && Number(await readFile(lock, 'utf8').catch(() => '')) === owner) {
        await rm(lock, { force: true })
        continue
      }
      if (Date.now() > deadline) throw new Error('WORKSHOP_STATE_BUSY', { cause: error })
      await delay(wait)
    }
  }
  try {
    return await run()
  } finally {
    await rm(lock, { force: true })
  }
}

/** Trust state on disk, one file per registry. Updates compare and replace under a cross-process lock. */
export function fileWorkshopTrustStore(directory: string): WorkshopTrustStore {
  let tail = Promise.resolve()
  const file = (registry: string) => {
    if (!registryIdPattern.test(registry)) throw new Error('WORKSHOP_REGISTRY_INVALID')
    return join(directory, registry + '.json')
  }
  const read = async (target: string) => {
    try {
      return JSON.parse(await readFile(target, 'utf8')) as WorkshopTrustState
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
  return {
    async read(registry) {
      return read(file(registry))
    },
    update(registry, next) {
      let target: string
      try {
        target = file(registry)
      } catch (error) {
        return Promise.reject(error)
      }
      const update = tail.then(async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 })
        return withFileLock(target, async () => {
          const state = next(await read(target))
          if (!state) return false
          const temp = join(directory, `.${registry}.${randomUUID()}.tmp`)
          try {
            await writeFile(temp, JSON.stringify(state), { flag: 'wx', mode: 0o600 })
            await rename(temp, target)
          } catch (error) {
            await rm(temp, { force: true })
            throw error
          }
          return true
        })
      })
      tail = update.then(
        () => {},
        () => {},
      )
      return update
    },
  }
}
