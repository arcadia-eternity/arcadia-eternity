import { mkdir, readdir, readFile, rm, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { errorCode, isRecord } from './types.ts'
import type { Job } from './jobs.ts'

const idPattern = /^[a-f0-9-]{36}$/

export type JournalJob = Job

export interface JobReceipt {
  pid: number
  live: boolean
  job: JournalJob
}

/** Local task receipts and cancellation requests are never part of a content package. */
export class JobJournal {
  directory: string
  #last = new Map<string, string>()
  constructor(root: string) {
    this.directory = join(root, '.arcadia', 'author-jobs')
  }
  file(id: string, suffix = 'json') {
    if (!idPattern.test(id)) throw new Error('TASK_INVALID')
    return join(this.directory, `${id}.${suffix}`)
  }
  async save(job: JournalJob, live: boolean) {
    const text = JSON.stringify({ pid: process.pid, live, job })
    if (this.#last.get(job.jobId) === text) return
    await mkdir(this.directory, { recursive: true })
    await writeFileAtomic(this.file(job.jobId), text, { mode: 0o600 })
    this.#last.set(job.jobId, text)
  }
  async read(): Promise<JobReceipt[]> {
    let names: string[]
    try {
      names = await readdir(this.directory)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return []
      throw error
    }
    const records: JobReceipt[] = []
    for (const name of names.filter(name => idPattern.test(name.slice(0, -5)) && name.endsWith('.json'))) {
      const file = join(this.directory, name)
      let info
      try {
        info = await lstat(file)
      } catch (error) {
        if (errorCode(error) === 'ENOENT') continue
        throw error
      }
      if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) continue
      let receipt: unknown
      try {
        receipt = JSON.parse(await readFile(file, 'utf8'))
      } catch (error) {
        if (error instanceof SyntaxError || errorCode(error) === 'ENOENT') continue
        throw error
      }
      if (!isRecord(receipt) || !isRecord(receipt.job)) continue
      const job = receipt.job
      if (
        typeof job.jobId !== 'string' ||
        `${job.jobId}.json` !== name ||
        typeof receipt.pid !== 'number' ||
        !Number.isInteger(receipt.pid) ||
        receipt.pid <= 0 ||
        !Array.isArray(job.diagnostics)
      )
        continue
      const live = receipt.live === true
      const state = typeof job.state === 'string' ? job.state : ''
      if (live || ['queued', 'running'].includes(state)) {
        try {
          process.kill(receipt.pid, 0)
        } catch (error) {
          if (errorCode(error) === 'ESRCH') {
            job.state = 'interrupted'
            job.diagnostics.push({
              code: 'TASK_INTERRUPTED',
              message: '任务宿主已退出；请重新运行。源项目和已安装版本保留。',
            })
          }
        }
      }
      records.push({ pid: receipt.pid, live, job: job as unknown as JournalJob })
    }
    const ordered = records.sort((a, b) => (a.job.createdAt ?? 0) - (b.job.createdAt ?? 0))
    const active = (receipt: JobReceipt) => receipt.live || ['queued', 'running'].includes(receipt.job.state)
    const history = new Set(ordered.filter(receipt => !active(receipt)).slice(-30))
    return ordered.filter(receipt => active(receipt) || history.has(receipt))
  }
  async requestCancel(id: string) {
    await writeFileAtomic(this.file(id, 'cancel'), '', { mode: 0o600 })
  }
  async cancelled(id: string) {
    try {
      await lstat(this.file(id, 'cancel'))
      return true
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return false
      throw error
    }
  }
  async remove(id: string) {
    await Promise.all(['json', 'cancel'].map(suffix => rm(this.file(id, suffix), { force: true })))
    this.#last.delete(id)
  }
}
