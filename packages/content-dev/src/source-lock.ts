import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, realpath, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import writeFileAtomic from 'write-file-atomic'
import { errorCode } from './types.ts'

const claimName = /^([1-9][0-9]*)-([a-f0-9-]{36})\.json$/
const busy = (file: string) =>
  Object.assign(new Error('其他作者操作正在保存此项目，请稍后重试'), { code: 'SOURCE_BUSY', file })
const invalid = (file: string) =>
  Object.assign(new Error('作者保存协调目录必须是普通目录'), { code: 'PATH_INVALID', file })

async function directory(root: string, file: string): Promise<string> {
  if ((await realpath(root)) !== root) throw invalid(file)
  let path = root
  for (const part of ['.arcadia', 'author-locks']) {
    path = join(path, part)
    try {
      await mkdir(path, { mode: 0o700 })
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
    }
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) throw invalid(file)
  }
  return path
}

interface Claim {
  name: string
  ticket: bigint | null
}

async function claims(path: string, file: string): Promise<Claim[]> {
  const names = (await readdir(path)).filter(name => claimName.test(name))
  if (names.length > 1024) throw busy(file)
  const result: Claim[] = []
  for (const name of names) {
    const match = claimName.exec(name)
    const pid = Number(match?.[1])
    if (!Number.isSafeInteger(pid)) throw busy(file)
    const claim = join(path, name)
    try {
      // Each attempt has a fresh UUID. Removing a dead process's claim cannot
      // remove a replacement owner's claim, unlike reclaiming one shared lock.
      try {
        process.kill(pid, 0)
      } catch (error) {
        if (errorCode(error) === 'ESRCH') {
          await unlink(claim)
          continue
        }
        if (errorCode(error) !== 'EPERM') throw error
      }
      const info = await lstat(claim)
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1024) throw invalid(file)
      let ticket: bigint | null = null
      try {
        const value = JSON.parse(await readFile(claim, 'utf8'))
        if (typeof value.ticket === 'string' && /^[1-9][0-9]{0,99}$/.test(value.ticket)) ticket = BigInt(value.ticket)
      } catch (error) {
        // An initial exclusive write may be visible before its bytes arrive.
        // Treat an incomplete live claim as choosing, never as unlocked.
        if (!(error instanceof SyntaxError)) throw error
      }
      result.push({ name, ticket })
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error
    }
  }
  return result
}

/** Serialize each source write across cooperating local author processes in this project.
 * One project lock also covers filename aliases on case-insensitive filesystems.
 * Each file still commits separately; ordinary external editors still use CAS checks.
 * Lamport's bakery ordering avoids stealing a live owner's lock after a timeout.
 * Claims live outside source revisions. PID reuse can delay recovery, never bypass a live owner.
 */
export async function withSourceLock<T>(
  root: string,
  file: string,
  action: () => Promise<T>,
  { timeoutMs = 5000 }: { timeoutMs?: number } = {},
): Promise<T> {
  const path = await directory(root, file)
  const name = `${process.pid}-${randomUUID()}.json`
  const claim = join(path, name)
  const deadline = Date.now() + timeoutMs
  const handle = await open(claim, 'wx', 0o600)
  try {
    try {
      await handle.writeFile(JSON.stringify({ ticket: null }))
    } finally {
      await handle.close()
    }
    const current = await claims(path, file)
    const ticket =
      current.reduce<bigint>(
        (highest, entry) => (entry.ticket !== null && entry.ticket > highest ? entry.ticket : highest),
        0n,
      ) + 1n
    await writeFileAtomic(claim, JSON.stringify({ ticket: ticket.toString() }), { mode: 0o600 })
    for (;;) {
      const contenders = await claims(path, file)
      const blocked = contenders.some(
        entry =>
          entry.name !== name &&
          (entry.ticket === null || entry.ticket < ticket || (entry.ticket === ticket && entry.name < name)),
      )
      if (!blocked) return await action()
      if (Date.now() >= deadline) throw busy(file)
      await delay(20)
    }
  } finally {
    await unlink(claim).catch(error => {
      if (errorCode(error) !== 'ENOENT') throw error
    })
  }
}
