import { mkdir, readdir, readFile, rm, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import writeFileAtomic from 'write-file-atomic'

const idPattern = /^[a-f0-9-]{36}$/
/** Local task receipts and cancellation requests are never part of a content package. */
export class JobJournal {
  directory: string
  #last = new Map()
  constructor(root: string) {
    this.directory = join(root, '.arcadia', 'author-jobs')
  }
  file(id, suffix = 'json') {
    if (!idPattern.test(id)) throw new Error('TASK_INVALID')
    return join(this.directory, `${id}.${suffix}`)
  }
  async save(job, live) {
    const text = JSON.stringify({ pid: process.pid, live, job })
    if (this.#last.get(job.jobId) === text) return
    await mkdir(this.directory, { recursive: true })
    await writeFileAtomic(this.file(job.jobId), text, { mode: 0o600 })
    this.#last.set(job.jobId, text)
  }
  async read() {
    let names
    try {
      names = await readdir(this.directory)
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
    const records = []
    for (const name of names.filter(name => idPattern.test(name.slice(0, -5)) && name.endsWith('.json'))) {
      const file = join(this.directory, name)
      let info
      try {
        info = await lstat(file)
      } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
      if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) continue
      let receipt
      try {
        receipt = JSON.parse(await readFile(file, 'utf8'))
      } catch (error) {
        if (error instanceof SyntaxError || error.code === 'ENOENT') continue
        throw error
      }
      if (
        !receipt.job ||
        `${receipt.job.jobId}.json` !== name ||
        !Number.isInteger(receipt.pid) ||
        receipt.pid <= 0 ||
        !Array.isArray(receipt.job.diagnostics)
      )
        continue
      if (receipt.live || ['queued', 'running'].includes(receipt.job.state)) {
        try {
          process.kill(receipt.pid, 0)
        } catch (error) {
          if (error.code === 'ESRCH') {
            receipt.live = false
            receipt.job.state = 'interrupted'
            receipt.job.diagnostics.push({
              code: 'TASK_INTERRUPTED',
              message: '任务宿主已退出；请重新运行。源项目和已安装版本保留。',
            })
          }
        }
      }
      records.push(receipt)
    }
    const ordered = records.sort((a, b) => (a.job.createdAt ?? 0) - (b.job.createdAt ?? 0))
    const active = receipt => receipt.live || ['queued', 'running'].includes(receipt.job.state)
    const history = new Set(ordered.filter(receipt => !active(receipt)).slice(-30))
    return ordered.filter(receipt => active(receipt) || history.has(receipt))
  }
  async requestCancel(id) {
    await writeFileAtomic(this.file(id, 'cancel'), '', { mode: 0o600 })
  }
  async cancelled(id) {
    try {
      await lstat(this.file(id, 'cancel'))
      return true
    } catch (error) {
      if (error.code === 'ENOENT') return false
      throw error
    }
  }
  async remove(id) {
    await Promise.all(['json', 'cancel'].map(suffix => rm(this.file(id, suffix), { force: true })))
    this.#last.delete(id)
  }
}
