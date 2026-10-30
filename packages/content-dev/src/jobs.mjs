import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { WorkspaceError, diagnostic } from './workspace.mjs'

const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url))
const terminal = new Set(['succeeded', 'failed', 'cancelled'])
/** Fixed author commands; no renderer or MCP-provided executable strings. */
export class AuthorJobs {
  #jobs = new Map()
  #active
  #closed = false
  #starting
  #changed
  constructor(workspace, { execute = false, env = process.env, executable = process.execPath } = {}) {
    this.workspace = workspace
    this.execute = execute
    this.env = Object.fromEntries(
      Object.entries(env).filter(([key]) =>
        /^(PATH|HOME|USERPROFILE|SystemRoot|WINDIR|TEMP|TMP|TMPDIR|LANG|LC_ALL|ARCADIA_NPM_CLI|npm_config_cache)$/i.test(
          key,
        ),
      ),
    )
    this.executable = executable
    this.#changed = () => {
      for (const { job } of this.#jobs.values()) if (terminal.has(job.state)) job.stale = true
    }
    workspace.on('change', this.#changed)
  }
  async start({ kind, sourceRevision }) {
    if (this.#closed) throw new WorkspaceError('WORKSPACE_CLOSED', '任务宿主已关闭')
    if (!['check', 'test', 'demo', 'pack'].includes(kind)) throw new WorkspaceError('TASK_INVALID', '不支持的作者任务')
    if (kind !== 'check' && !this.execute) throw new WorkspaceError('EXECUTION_DISABLED', '此会话未启用项目代码执行')
    if (this.#active) throw new WorkspaceError('TASK_BUSY', '请等待或取消当前任务')
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
      const job = { jobId, kind, sourceRevision: revision, state: 'queued', stale: false, output: '', diagnostics: [] }
      const control = { job, controller: new AbortController() }
      this.#jobs.set(jobId, control)
      while (this.#jobs.size > 30) this.#jobs.delete(this.#jobs.keys().next().value)
      control.done = this.#run(control).finally(() => {
        this.#active = undefined
      })
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
    return [...this.#jobs.keys()].map(id => this.get(id)).reverse()
  }
  cancel(jobId) {
    const control = this.#jobs.get(jobId)
    if (!control) throw new WorkspaceError('TASK_UNKNOWN', '任务不存在')
    if (!terminal.has(control.job.state)) control.controller.abort()
    return this.get(jobId)
  }
  async #run({ job, controller }) {
    const signal = controller.signal
    const timeout = setTimeout(() => controller.abort(), 180000)
    let state = 'succeeded'
    try {
      job.state = 'running'
      if (job.kind === 'check') {
        const snapshot = await this.workspace.snapshot()
        job.diagnostics.push(...snapshot.diagnostics)
        if (snapshot.diagnostics.length) throw new WorkspaceError('CHECK_FAILED', '源数据检查失败')
        await this.#process([cli, 'check'], job, signal)
      } else if (job.kind === 'pack') await this.#process([cli, 'pack'], job, signal)
      else {
        await this.#process([cli, 'build'], job, signal)
        if (job.kind === 'demo') await this.#process([cli, 'demo'], job, signal)
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
      } catch (error) {
        job.stale = true
        job.diagnostics.push(diagnostic(error))
      }
      job.finishedAt = new Date().toISOString()
      job.state = state
    }
  }
  async #process(args, job, signal) {
    if (signal.aborted) throw new WorkspaceError('TASK_CANCELLED', '任务已取消')
    await new Promise((resolve, reject) => {
      const child = spawn(this.executable, args, {
        cwd: this.workspace.root,
        env: { ...this.env, ELECTRON_RUN_AS_NODE: '1', ARCADIA_AUTHOR_RESULT: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
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
      const output = chunk => {
        job.output = (job.output + chunk.toString()).slice(-1024 * 1024)
      }
      child.stdout.on('data', output)
      child.stderr.on('data', output)
      child.once('error', reject)
      child.once('close', code => {
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
    for (const control of this.#jobs.values()) if (!terminal.has(control.job.state)) control.controller.abort()
    await Promise.allSettled([...this.#jobs.values()].map(control => control.done))
  }
}
