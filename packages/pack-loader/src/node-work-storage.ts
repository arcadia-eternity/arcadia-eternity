import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { emptyWorkspace, parseWorkspace, type WorkSnapshot, type WorkStorage, type WorkWorkspace } from './works/store'
import { limits } from './works/model'

/** One atomic workspace snapshot; immutable releases and blobs are committed together. */
export class NodeWorkStorage implements WorkStorage {
  private readonly file: string
  private readonly lock: string
  constructor(private readonly directory: string) {
    this.file = resolve(directory, 'works.json')
    this.lock = resolve(directory, 'works.lock')
  }
  async read(): Promise<WorkSnapshot> {
    try {
      const handle = await open(this.file, 'r')
      try {
        if ((await handle.stat()).size > limits.bytes) throw new Error('作品库超过大小限制')
        const value = JSON.parse(await handle.readFile('utf8')) as WorkSnapshot
        if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('作品库修订号无效')
        return { revision: value.revision, workspace: parseWorkspace(value.workspace) }
      } finally {
        await handle.close()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { revision: 0, workspace: emptyWorkspace() }
      throw error
    }
  }
  async compareAndSwap(expected: number, input: WorkWorkspace): Promise<boolean> {
    const workspace = parseWorkspace(input)
    await mkdir(this.directory, { recursive: true })
    let lock
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        lock = await open(this.lock, 'wx', 0o600)
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }
    if (!lock) throw new Error('作品库正被其他进程写入；若进程已退出，请检查 works.lock 后重试')
    const temporary = resolve(this.directory, `works-${randomUUID()}.tmp`)
    try {
      if ((await this.read()).revision !== expected) return false
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify({ revision: expected + 1, workspace }))
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporary, this.file)
      return true
    } finally {
      await unlink(temporary).catch(error => {
        if (error.code !== 'ENOENT') throw error
      })
      await lock.close()
      await unlink(this.lock)
    }
  }
}
