import { mkdir, open, readFile, rename, unlink, link, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { ProfileError, RAW_BINARY_PREFIX } from './schema'
import { validateEnvelope, type Envelope, type ProfileStorage, type ProfileExpectation } from './repository'

export function profileDirectory(explicit?: string): string {
  return resolve(explicit ?? process.env.ARCADIA_PROFILE_DIR ?? join(homedir(), '.arcadia', 'profile'))
}
function code(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code
}
export class FileProfileStorage implements ProfileStorage {
  private closing = false
  private ownerRelease?: () => Promise<void>
  private pending: Promise<void> = Promise.resolve()
  constructor(readonly directory: string) {}
  async acquireOwner() {
    if (this.closing) throw new ProfileError('STORAGE_CLOSED')
    this.ownerRelease ??= await this.acquire()
  }
  async close() {
    this.closing = true
    await this.pending
    await this.ownerRelease?.()
    this.ownerRelease = undefined
  }
  async readRaw(): Promise<string | null> {
    let bytes: Buffer
    try {
      bytes = await readFile(join(this.directory, 'profile.json'))
    } catch (error) {
      if (code(error) === 'ENOENT') return null
      throw new ProfileError('STORAGE_DENIED')
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      return text.startsWith(RAW_BINARY_PREFIX) ? RAW_BINARY_PREFIX + bytes.toString('base64') : text
    } catch {
      return RAW_BINARY_PREFIX + bytes.toString('base64')
    }
  }
  async read(): Promise<Envelope | null> {
    const bytes = await this.readRaw()
    if (bytes === null) return null
    let value: unknown
    try {
      value = JSON.parse(bytes)
    } catch {
      throw new ProfileError('PROFILE_CORRUPT')
    }
    return validateEnvelope(value)
  }
  private async acquire(): Promise<() => Promise<void>> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await this.checkRecoveryGates()
    const lock = join(this.directory, 'owner.lock'),
      owner = join(this.directory, `.owner-${randomUUID()}`)
    const handle = await open(owner, 'wx', 0o600)
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid }))
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await link(owner, lock)
    } catch (error) {
      throw new ProfileError(code(error) === 'EEXIST' ? 'PROFILE_BUSY' : 'STORAGE_DENIED')
    } finally {
      await unlink(owner)
    }
    try {
      await this.checkRecoveryGates()
    } catch (error) {
      await unlink(lock)
      throw error
    }
    return () => unlink(lock)
  }
  commit(expected: ProfileExpectation, next: Envelope): Promise<void> {
    if (this.closing) return Promise.reject(new ProfileError('STORAGE_CLOSED'))
    const task = this.pending.catch(() => {}).then(() => this.write(expected, next))
    this.pending = task.catch(() => {})
    return task
  }
  private async write(expected: ProfileExpectation, next: Envelope) {
    const release = this.ownerRelease ? undefined : await this.acquire()
    const temporary = join(this.directory, `.profile-${randomUUID()}.tmp`)
    try {
      if (typeof expected === 'object' && expected !== null) {
        if ((await this.readRaw()) !== expected.corrupt) throw new ProfileError('REVISION_CONFLICT')
      } else {
        const old = await this.read()
        if ((old?.current.revision ?? null) !== expected) throw new ProfileError('REVISION_CONFLICT')
      }
      const file = await open(temporary, 'wx', 0o600)
      try {
        await file.writeFile(JSON.stringify(next) + '\n')
        await file.sync()
      } finally {
        await file.close()
      }
      await rename(temporary, join(this.directory, 'profile.json'))
    } catch (error) {
      if (error instanceof ProfileError) throw error
      throw new ProfileError(code(error) === 'ENOSPC' ? 'STORAGE_FULL' : 'STORAGE_DENIED')
    } finally {
      await unlink(temporary).catch(() => {})
      await release?.()
    }
  }
  /** Each recovery contender has an immutable, unique pathname: stale cleanup cannot delete a new gate. */
  private async checkRecoveryGates(own?: string): Promise<void> {
    for (const name of await readdir(this.directory)) {
      if (!/^recovery-[a-f0-9-]+\.lock$/.test(name) || name === own) continue
      const file = join(this.directory, name)
      let pid: number
      try {
        pid = JSON.parse(await readFile(file, 'utf8')).pid
      } catch (error) {
        if (code(error) === 'ENOENT') continue
        throw new ProfileError('PROFILE_BUSY')
      }
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new ProfileError('PROFILE_BUSY')
      try {
        process.kill(pid, 0)
      } catch (error) {
        if (code(error) === 'ESRCH') {
          await unlink(file).catch(error => {
            if (code(error) !== 'ENOENT') throw error
          })
          continue
        }
      }
      throw new ProfileError('PROFILE_BUSY', '另一个恢复操作尚未结束')
    }
  }
  /** Recovery excludes both new owners and other recovery attempts. Never evict a live PID. */
  async unlock(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const name = `recovery-${randomUUID()}.lock`,
      gate = join(this.directory, name)
    const temporary = join(this.directory, `.recovery-${randomUUID()}`)
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid }))
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await link(temporary, gate)
    } finally {
      await unlink(temporary)
    }
    try {
      await this.checkRecoveryGates(name)
      await this.removeDeadOwner()
    } finally {
      await unlink(gate)
    }
  }
  private async removeDeadOwner(): Promise<void> {
    const file = join(this.directory, 'owner.lock')
    let value: { pid: number }
    try {
      value = JSON.parse(await readFile(file, 'utf8'))
    } catch (error) {
      if (code(error) === 'ENOENT') return
      throw new ProfileError('PROFILE_BUSY')
    }
    if (!Number.isSafeInteger(value.pid) || value.pid <= 0) throw new ProfileError('PROFILE_BUSY')
    try {
      process.kill(value.pid, 0)
    } catch (error) {
      if (code(error) === 'ESRCH') {
        await unlink(file)
        return
      }
    }
    throw new ProfileError('PROFILE_BUSY', '资料仍被其他进程占用')
  }
}
