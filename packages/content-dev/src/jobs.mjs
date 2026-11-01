import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkspaceError, diagnostic } from './workspace.mjs'
import { JobJournal } from './job-journal.mjs'

const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url))
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'interrupted'])
/** Fixed author commands; no renderer or MCP-provided executable strings. */
export class AuthorJobs {
  #jobs = new Map()
  #active
  #closed = false
  #starting
  #changed
  #previews = new Map()
  #journal
  #sync = Promise.resolve()
  #timer
  constructor(workspace, { execute = false, env = process.env, executable = process.execPath } = {}) {
    this.workspace = workspace
    this.execute = execute
    this.env = Object.fromEntries(
      Object.entries(env).filter(([key]) =>
        /^(PATH|HOME|USERPROFILE|SystemRoot|WINDIR|TEMP|TMP|TMPDIR|LANG|LC_ALL|ARCADIA_NPM_CLI|ARCADIA_PREVIEW_CLIENT_URL|npm_config_cache)$/i.test(
          key,
        ),
      ),
    )
    this.executable = executable
    this.#changed = () => {
      for (const { job } of this.#jobs.values()) if (terminal.has(job.state)) job.stale = true
    }
    workspace.on('change', this.#changed)
    if (!workspace.readOnly && workspace.root) this.#journal = new JobJournal(workspace.root)
  }
  get closed() {
    return this.#closed
  }
  async initialize() {
    await this.refresh()
    this.#timer = setInterval(() => {
      void this.#checkpoint().catch(() => {})
    }, 250)
    this.#timer.unref()
  }
  #checkpoint() {
    this.#sync = this.#sync
      .catch(() => {})
      .then(async () => {
        if (!this.#journal) return
        for (const { job, controller } of this.#jobs.values()) {
          if (!controller) continue
          if ((!terminal.has(job.state) || this.#previews.has(job.jobId)) && (await this.#journal.cancelled(job.jobId)))
            this.cancel(job.jobId)
          await this.#journal.save(job, this.#previews.has(job.jobId))
        }
      })
    return this.#sync
  }
  async refresh() {
    await this.#checkpoint()
    if (!this.#journal) return
    const revision = await this.workspace.revision()
    for (const { job } of this.#jobs.values())
      if (terminal.has(job.state)) job.stale ||= job.sourceRevision !== revision
    for (const receipt of await this.#journal.read()) {
      if (this.#jobs.get(receipt.job.jobId)?.controller) continue
      receipt.job.stale ||= receipt.job.sourceRevision !== revision
      this.#jobs.set(receipt.job.jobId, { job: receipt.job, live: receipt.live })
    }
  }
  async start({ kind, sourceRevision }) {
    if (this.workspace.assertWritable) await this.workspace.assertWritable()
    if (this.#closed) throw new WorkspaceError('WORKSPACE_CLOSED', '任务宿主已关闭')
    if (!['check', 'test', 'demo', 'preview', 'pack'].includes(kind))
      throw new WorkspaceError('TASK_INVALID', '不支持的作者任务')
    if (kind !== 'check' && !this.execute) throw new WorkspaceError('EXECUTION_DISABLED', '此会话未启用项目代码执行')
    if (this.#active) throw new WorkspaceError('TASK_BUSY', '请等待或取消当前任务')
    if (kind === 'preview' && this.#previews.size >= 4)
      throw new WorkspaceError('PREVIEW_LIMIT', '请先停止一个旧试玩，再准备新候选')
    const jobId = randomUUID()
    // Reserve before fingerprinting so concurrent starts cannot race.
    this.#active = jobId
    let started
    this.#starting = new Promise(resolve => {
      started = resolve
    })
    try {
      const revision = await this.workspace.revision()
      if (this.#closed) throw new WorkspaceError('WORKSPACE_CLOSED', '任务宿主已关闭')
      if (sourceRevision && sourceRevision !== revision)
        throw new WorkspaceError('REVISION_CONFLICT', '项目已改变，请重新读取')
      const job = {
        jobId,
        kind,
        sourceRevision: revision,
        state: 'queued',
        stale: false,
        output: '',
        diagnostics: [],
        createdAt: Date.now(),
      }
      const control = { job, controller: new AbortController() }
      this.#jobs.set(jobId, control)
      for (const [id, value] of this.#jobs) {
        if (this.#jobs.size <= 30) break
        if (terminal.has(value.job.state) && !this.#previews.has(id) && !value.live) {
          this.#jobs.delete(id)
          await this.#journal?.remove(id)
        }
      }
      control.done = this.#run(control).finally(() => {
        this.#active = undefined
      })
      await this.#checkpoint()
      return this.get(jobId)
    } catch (error) {
      this.#active = undefined
      throw error
    } finally {
      started()
      this.#starting = undefined
    }
  }
  get(jobId) {
    const control = this.#jobs.get(jobId)
    if (!control) throw new WorkspaceError('TASK_UNKNOWN', '任务不存在或已过期')
    return structuredClone(control.job)
  }
  list() {
    return [...this.#jobs.keys()].map(id => this.get(id)).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  }
  cancel(jobId) {
    const control = this.#jobs.get(jobId)
    if (!control) throw new WorkspaceError('TASK_UNKNOWN', '任务不存在')
    if (!control.controller) {
      if (!terminal.has(control.job.state) || control.live)
        return this.#journal.requestCancel(jobId).then(() => this.get(jobId))
      return this.get(jobId)
    }
    if (!terminal.has(control.job.state) || this.#previews.has(jobId)) {
      control.controller.abort()
      if (this.#previews.has(jobId)) control.job.state = 'cancelled'
    }
    return this.get(jobId)
  }
  async #run({ job, controller }) {
    const signal = controller.signal
    const timeout = setTimeout(() => controller.abort(), 180000)
    let state = 'succeeded'
    let capture
    try {
      job.state = 'running'
      if (job.kind === 'preview') {
        capture = await mkdtemp(join(tmpdir(), 'arcadia-author-candidate-'))
        for (const entry of await this.workspace.files()) {
          if (signal.aborted) throw new WorkspaceError('TASK_CANCELLED', '任务已取消')
          if (entry.error) throw new WorkspaceError('SOURCE_INVALID', entry.error, entry.file)
          const target = join(capture, entry.file)
          await mkdir(dirname(target), { recursive: true })
          await cp(await this.workspace.path(entry.file), target)
        }
        await symlink(
          join(this.workspace.root, 'node_modules'),
          join(capture, 'node_modules'),
          process.platform === 'win32' ? 'junction' : 'dir',
        )
        if ((await this.workspace.revision()) !== job.sourceRevision)
          throw new WorkspaceError('PREVIEW_STALE', '复制候选期间源码已改变，请重试')
      }
      if (job.kind === 'check') {
        const snapshot = await this.workspace.snapshot()
        job.diagnostics.push(...snapshot.diagnostics)
        if (snapshot.diagnostics.length) throw new WorkspaceError('CHECK_FAILED', '源数据检查失败')
        await this.#process([cli, 'check'], job, signal)
      } else if (job.kind === 'pack') await this.#process([cli, 'pack'], job, signal)
      else {
        await this.#process([cli, 'build'], job, signal, false, capture)
        if (job.kind === 'demo' || job.kind === 'preview')
          await this.#process([cli, job.kind], job, signal, job.kind === 'preview', capture)
        else {
          const files = (await this.workspace.files()).filter(entry =>
            /^(test|tests)\/.+\.test\.(mjs|js|cjs)$/.test(entry.file),
          )
          if (!files.length)
            throw new WorkspaceError('TESTS_MISSING', '未发现 test/ 或 tests/ 下的 *.test.mjs/js/cjs 场景')
          await this.#process(['--test', '--test-reporter=tap', ...files.map(entry => entry.file)], job, signal)
        }
      }
    } catch (error) {
      state = signal.aborted ? 'cancelled' : 'failed'
      job.diagnostics.push(diagnostic(error))
    } finally {
      clearTimeout(timeout)
      try {
        job.stale = (await this.workspace.revision()) !== job.sourceRevision
        if (job.stale && job.kind === 'preview') {
          controller.abort()
          state = 'failed'
          job.diagnostics.push(diagnostic(new WorkspaceError('PREVIEW_STALE', '准备期间源码已改变，请重新试玩')))
        }
      } catch (error) {
        job.stale = true
        job.diagnostics.push(diagnostic(error))
      }
      job.finishedAt = new Date().toISOString()
      if (capture && !this.#previews.has(job.jobId)) await rm(capture, { recursive: true, force: true })
      job.state = state
    }
  }
  async #process(args, job, signal, preview = false, capture) {
    if (signal.aborted) throw new WorkspaceError('TASK_CANCELLED', '任务已取消')
    await new Promise((resolve, reject) => {
      const child = spawn(this.executable, args, {
        cwd: capture ?? this.workspace.root,
        env: { ...this.env, ELECTRON_RUN_AS_NODE: '1', ARCADIA_AUTHOR_RESULT: '1' },
        stdio: ['ignore', 'pipe', 'pipe', ...(preview ? ['ipc'] : [])],
        windowsHide: true,
        detached: process.platform !== 'win32',
      })
      let killTimer
      const kill = force => {
        try {
          if (process.platform !== 'win32') process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
          else child.kill(force ? 'SIGKILL' : 'SIGTERM')
        } catch {
          /* Already exited. */
        }
      }
      const abort = () => {
        kill(false)
        killTimer = setTimeout(() => kill(true), 1500)
      }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      let buffer = '',
        ready = false
      const output = chunk => {
        const text = chunk.toString()
        job.output = (job.output + text).slice(-1024 * 1024)
        if (!preview || ready) return
        buffer += text
        let newline
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          if (!line.startsWith('ARCADIA_RESULT=')) continue
          try {
            const result = JSON.parse(line.slice('ARCADIA_RESULT='.length))
            if (!result.preview?.endpoint || signal.aborted) continue
            job.result = result
            ready = true
            resolve()
          } catch {
            /* Preserve incomplete or malformed output for diagnosis. */
          }
        }
      }
      let finished
      if (preview)
        this.#previews.set(
          job.jobId,
          new Promise(resolve => {
            finished = resolve
          }),
        )
      child.stdout.on('data', output)
      child.stderr.on('data', output)
      child.once('error', reject)
      child.once('close', code => {
        if (preview) {
          this.#previews.delete(job.jobId)
          const released = capture ? rm(capture, { recursive: true, force: true }) : Promise.resolve()
          void released.then(finished, error => {
            job.diagnostics.push(diagnostic(error))
            finished()
          })
          if (ready) {
            job.state = signal.aborted ? 'cancelled' : 'failed'
            if (!signal.aborted)
              job.diagnostics.push(diagnostic(new WorkspaceError('PREVIEW_EXITED', '试玩进程已退出，请重新准备')))
          }
        }
        clearTimeout(killTimer)
        signal.removeEventListener('abort', abort)
        for (const raw of job.output.split('\n')) {
          const line = raw.replace(/^# /, '')
          if (line.startsWith('ARCADIA_RESULT=')) {
            try {
              job.result = JSON.parse(line.slice('ARCADIA_RESULT='.length))
            } catch {
              /* Keep malformed output in the log. */
            }
          }
          const match = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/.exec(line)
          if (match)
            job.diagnostics.push({
              code: match[4],
              severity: 'error',
              file: match[1],
              line: Number(match[2]),
              column: Number(match[3]),
              message: match[5],
            })
        }
        if (code === 0 && !signal.aborted) resolve()
        else
          reject(
            new WorkspaceError(
              signal.aborted ? 'TASK_CANCELLED' : 'TASK_FAILED',
              signal.aborted ? '任务已取消或超过三分钟' : `作者命令失败（${code}），请查看诊断与输出`,
            ),
          )
      })
    })
  }
  async close() {
    this.#closed = true
    this.workspace.off('change', this.#changed)
    await this.#starting
    clearInterval(this.#timer)
    for (const control of this.#jobs.values())
      if (control.controller && (!terminal.has(control.job.state) || this.#previews.has(control.job.jobId)))
        control.controller.abort()
    await Promise.allSettled([...this.#jobs.values()].map(control => control.done))
    await Promise.allSettled([...this.#previews.values()])
    await this.#checkpoint()
  }
}
