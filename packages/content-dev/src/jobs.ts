import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, rm, symlink, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { AuthorWorkspace, WorkspaceError, diagnostic } from './workspace.ts'
import { JobJournal } from './job-journal.ts'
import { siblingModulePath } from './module-path.ts'

const cli = siblingModulePath('cli')
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'interrupted'])
const outputLimit = 1024 * 1024
function queryError(message: string): never {
  throw new WorkspaceError('TASK_QUERY_INVALID', message)
}
function integer(value: unknown, minimum: number, maximum: number, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum)
    queryError(`${name} 超出范围`)
  return value
}

interface JobDiagnostic {
  code: string
  severity?: string
  message: string
  file?: string
  line?: number
  column?: number
}

interface JobResult {
  preview?: { endpoint: string; clientPath: string; url?: string }
  environmentLock?: { file: string; version: string }
  sourceRevisions?: Record<string, string>
  files?: unknown[]
  [key: string]: unknown
}

export interface Job {
  jobId: string
  kind: string
  sourceRevision: string
  contentRevision: string
  environmentId: string
  preparationRevision: string
  state: string
  phase: string
  stale: boolean
  output: string
  outputCursor: number
  diagnostics: JobDiagnostic[]
  createdAt: number
  finishedAt?: string
  result?: JobResult
}

interface JobControl {
  job: Job
  controller?: AbortController
  live?: boolean
  done?: Promise<void>
}

function outputRange(job: Pick<Job, 'output' | 'outputCursor'>) {
  const text = typeof job.output === 'string' ? job.output : ''
  // Receipts written by older versions have no cursor; their retained output starts at zero.
  const end = Number.isSafeInteger(job.outputCursor) ? Math.max(job.outputCursor, text.length) : text.length
  return { text, start: end - text.length, end }
}
function resultSummary(result: unknown) {
  if (!result || typeof result !== 'object') return undefined
  const record = result as Record<string, unknown>
  const summary: Record<string, unknown> = {}
  for (const key of [
    'candidate',
    'preview',
    'environmentLock',
    'sourceRevisions',
    'filename',
    'integrity',
    'shasum',
    'winner',
    'turns',
    'environmentRevision',
    'packageName',
  ])
    if (record[key] !== undefined) summary[key] = structuredClone(record[key])
  if (Array.isArray(record.files)) summary.fileCount = record.files.length
  return summary
}
function jobSummary(job: Job, details = false) {
  const { start, end } = outputRange(job)
  const summary: Record<string, unknown> = {
    jobId: job.jobId,
    kind: job.kind,
    state: job.state,
    phase: job.phase ?? job.state,
    stale: !!job.stale,
    sourceRevision: job.sourceRevision,
    contentRevision: job.contentRevision,
    environmentId: job.environmentId,
    createdAt: job.createdAt,
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    diagnosticCount: job.diagnostics.length,
    outputStartCursor: start,
    outputCursor: end,
  }
  if (details) {
    summary.diagnostics = job.diagnostics.slice(0, 100).map((item: JobDiagnostic) => ({
      ...item,
      message: typeof item.message === 'string' ? item.message.slice(0, 4000) : item.message,
    }))
    summary.diagnosticsTruncated =
      job.diagnostics.length > 100 || job.diagnostics.some(item => item.message?.length > 4000)
    const result = resultSummary(job.result)
    if (result) summary.result = result
  }
  return summary
}
/** Fixed author commands; no renderer or MCP-provided executable strings. */
export class AuthorJobs {
  workspace: AuthorWorkspace
  execute: boolean
  env: Record<string, string>
  executable: string
  #jobs = new Map<string, JobControl>()
  #active: string | undefined
  #closed = false
  #starting: Promise<void> | undefined
  #changed: (event?: { file?: string }) => void
  #previews = new Map<string, Promise<void>>()
  #journal: JobJournal | undefined
  #sync: Promise<void> = Promise.resolve()
  #timer: ReturnType<typeof setInterval> | undefined
  #waiters = new Set<() => void>()
  constructor(
    workspace: AuthorWorkspace,
    {
      execute = false,
      env = process.env,
      executable = process.execPath,
    }: { execute?: boolean; env?: NodeJS.ProcessEnv; executable?: string } = {},
  ) {
    this.workspace = workspace
    this.execute = execute
    this.env = Object.fromEntries(
      Object.entries(env).filter(([key]) =>
        /^(PATH|HOME|USERPROFILE|SystemRoot|WINDIR|TEMP|TMP|TMPDIR|LANG|LC_ALL|ARCADIA_NPM_CLI|ARCADIA_PREVIEW_CLIENT_URL|npm_config_cache)$/i.test(
          key,
        ),
      ),
    ) as Record<string, string>
    this.executable = executable
    this.#changed = ({ file }: { file?: string } = {}) => {
      for (const { job } of this.#jobs.values())
        if (
          terminal.has(job.state) &&
          !(job.kind === 'preview' && (file?.startsWith('debug/teams/') || file === job.result?.environmentLock?.file))
        )
          job.stale = true
      this.#notify()
    }
    workspace.on('change', this.#changed)
    if (!workspace.readOnly && workspace.root) this.#journal = new JobJournal(workspace.root)
  }
  get closed() {
    return this.#closed
  }
  get hasLivePreviews() {
    return this.#previews.size > 0
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
  async #dependenciesCurrent(job: Job): Promise<boolean> {
    const revisions = Object.entries(job.result?.sourceRevisions ?? {})
    if (!revisions.length) return true
    try {
      const mappings = JSON.parse(
        await readFile(join(this.workspace.root, '.arcadia/debug-sources.json'), 'utf8'),
      ) as Record<string, unknown>
      for (const [name, revision] of revisions) {
        if (typeof mappings[name] !== 'string') return false
        const source = await AuthorWorkspace.open(mappings[name], { watch: false })
        try {
          if ((await source.revision({ contentOnly: true })) !== revision) return false
        } finally {
          await source.close()
        }
      }
      return true
    } catch {
      return false
    }
  }
  async refresh() {
    await this.#checkpoint()
    if (!this.#journal) return
    const revision = await this.workspace.revision()
    const contentRevision = await this.workspace.revision({ contentOnly: true })
    for (const { job } of this.#jobs.values())
      if (terminal.has(job.state))
        job.stale ||=
          job.kind === 'preview'
            ? job.contentRevision !== contentRevision || !(await this.#dependenciesCurrent(job))
            : job.sourceRevision !== revision
    await this.#refreshReceipts({ revision, contentRevision })
  }
  async #refreshReceipts(revisions?: { revision: string; contentRevision: string }): Promise<void> {
    if (!this.#journal) return
    const receipts = await this.#journal.read()
    const present = new Set(receipts.map(receipt => receipt.job.jobId))
    for (const [id, control] of this.#jobs) if (!control.controller && !present.has(id)) this.#jobs.delete(id)
    for (const receipt of receipts) {
      if (this.#jobs.get(receipt.job.jobId)?.controller) continue
      receipt.job.stale ||= this.#jobs.get(receipt.job.jobId)?.job.stale ?? false
      if (revisions)
        receipt.job.stale ||=
          receipt.job.kind === 'preview'
            ? receipt.job.contentRevision !== revisions.contentRevision ||
              !(await this.#dependenciesCurrent(receipt.job))
            : receipt.job.sourceRevision !== revisions.revision
      this.#jobs.set(receipt.job.jobId, { job: receipt.job, live: receipt.live })
    }
  }
  async start({
    kind,
    sourceRevision,
    environmentId = 'default',
  }: {
    kind: string
    sourceRevision?: string
    environmentId?: string
  }): Promise<Job> {
    if (this.workspace.assertWritable) await this.workspace.assertWritable()
    if (this.#closed) throw new WorkspaceError('WORKSPACE_CLOSED', '任务宿主已关闭')
    if (!['check', 'test', 'demo', 'preview', 'pack'].includes(kind))
      throw new WorkspaceError('TASK_INVALID', '不支持的作者任务')
    if (kind !== 'check' && !this.execute) throw new WorkspaceError('EXECUTION_DISABLED', '此会话未启用项目代码执行')
    if (this.#active) throw new WorkspaceError('TASK_BUSY', '请等待或取消当前任务')
    if (kind === 'preview' && this.#previews.size >= 4)
      throw new WorkspaceError('PREVIEW_LIMIT', '请先停止一个旧试玩，再准备新候选')
    if (typeof environmentId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(environmentId))
      throw new WorkspaceError('ENVIRONMENT_INVALID', '环境标识无效')
    const jobId = randomUUID()
    // Reserve before fingerprinting so concurrent starts cannot race.
    this.#active = jobId
    let started: () => void = () => {}
    this.#starting = new Promise<void>(resolve => {
      started = resolve
    })
    try {
      const revision = await this.workspace.revision()
      if (this.#closed) throw new WorkspaceError('WORKSPACE_CLOSED', '任务宿主已关闭')
      if (sourceRevision && sourceRevision !== revision)
        throw new WorkspaceError('REVISION_CONFLICT', '项目已改变，请重新读取')
      const job: Job = {
        jobId,
        kind,
        sourceRevision: revision,
        contentRevision: await this.workspace.revision({ contentOnly: true }),
        environmentId,
        preparationRevision: await this.workspace.revision({
          contentOnly: true,
          excludeFile:
            environmentId === 'default' ? undefined : `debug/environments/${environmentId}.package-lock.json`,
        }),
        state: 'queued',
        phase: 'queued',
        stale: false,
        output: '',
        outputCursor: 0,
        diagnostics: [],
        createdAt: Date.now(),
      }
      const control: JobControl = { job, controller: new AbortController() }
      this.#jobs.set(jobId, control)
      for (const [id, value] of this.#jobs) {
        if (this.#jobs.size <= 30) break
        if (terminal.has(value.job.state) && !this.#previews.has(id) && !value.live) {
          this.#jobs.delete(id)
          await this.#journal?.remove(id)
        }
      }
      await this.#checkpoint()
      control.done = this.#run(control).finally(() => {
        this.#active = undefined
      })
      return this.get(jobId)
    } catch (error) {
      this.#jobs.delete(jobId)
      this.#active = undefined
      throw error
    } finally {
      started()
      this.#starting = undefined
    }
  }
  get(jobId: string): Job {
    const control = this.#jobs.get(jobId)
    if (!control) throw new WorkspaceError('TASK_UNKNOWN', '任务不存在或已过期')
    return structuredClone(control.job)
  }
  list(): Job[] {
    return [...this.#jobs.keys()].map(id => this.get(id)).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  }
  /** Compact task discovery; listing never switches or replaces a desktop preview. */
  async queryJobs({
    offset = 0,
    limit = 20,
    state,
    kind,
  }: { offset?: number; limit?: number; state?: string; kind?: string } = {}) {
    integer(offset, 0, Number.MAX_SAFE_INTEGER, 'offset')
    integer(limit, 1, 100, 'limit')
    if (state !== undefined && !['queued', 'running', ...terminal].includes(state)) queryError('任务状态无效')
    if (kind !== undefined && !['check', 'test', 'demo', 'preview', 'pack'].includes(kind)) queryError('任务类型无效')
    await this.refresh()
    const rows = [...this.#jobs.values()]
      .map(({ job }) => job)
      .filter(job => (!state || job.state === state) && (!kind || job.kind === kind))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.jobId.localeCompare(b.jobId))
    return {
      total: rows.length,
      offset,
      nextOffset: offset + limit < rows.length ? offset + limit : null,
      items: rows.slice(offset, offset + limit).map(job => jobSummary(job)),
    }
  }
  /** Wait for changes without repeatedly hashing every project file. */
  async queryJob({
    jobId,
    waitMs = 0,
    afterCursor,
    includeOutput = false,
    limit = 16384,
  }: {
    jobId: string
    waitMs?: number
    afterCursor?: number
    includeOutput?: boolean
    limit?: number
  }) {
    integer(waitMs, 0, 10000, 'waitMs')
    integer(limit, 1, 65536, 'limit')
    if (afterCursor !== undefined) integer(afterCursor, 0, Number.MAX_SAFE_INTEGER, 'afterCursor')
    if (typeof includeOutput !== 'boolean') queryError('includeOutput 需要布尔值')
    await this.refresh()
    let job = this.get(jobId)
    if (afterCursor !== undefined && afterCursor > outputRange(job).end) queryError('日志游标超出当前输出')
    const observed = JSON.stringify(jobSummary(job, true))
    const deadline = Date.now() + waitMs
    while (
      !this.#closed &&
      !terminal.has(job.state) &&
      (afterCursor === undefined || outputRange(job).end <= afterCursor) &&
      JSON.stringify(jobSummary(job, true)) === observed &&
      Date.now() < deadline
    ) {
      await this.#wait(Math.min(250, deadline - Date.now()))
      // Peer receipts are checkpointed by their owner. This does not mutate peer tasks.
      await this.#refreshReceipts()
      job = this.get(jobId)
    }
    const summary = jobSummary(job, true)
    if (includeOutput) summary.output = this.#output(jobId, afterCursor ?? 0, limit)
    return summary
  }
  async readJobOutput({ jobId, cursor = 0, limit = 16384 }: { jobId: string; cursor?: number; limit?: number }) {
    integer(cursor, 0, Number.MAX_SAFE_INTEGER, 'cursor')
    integer(limit, 1, 65536, 'limit')
    await this.#refreshReceipts()
    return this.#output(jobId, cursor, limit)
  }
  #output(jobId: string, cursor: number, limit: number) {
    const { text, start, end } = outputRange(this.get(jobId))
    if (cursor > end) queryError('日志游标超出当前输出')
    const first = Math.max(cursor, start)
    const nextCursor = Math.min(first + limit, end)
    return {
      jobId,
      text: text.slice(first - start, nextCursor - start),
      cursor: first,
      nextCursor,
      endCursor: end,
      truncated: cursor < start,
      hasMore: nextCursor < end,
      unit: 'utf16',
    }
  }
  #notify() {
    for (const wake of this.#waiters) wake()
  }
  #wait(milliseconds: number): Promise<void> {
    return new Promise<void>(resolve => {
      const wake = () => {
        clearTimeout(timer)
        this.#waiters.delete(wake)
        resolve()
      }
      const timer = setTimeout(wake, milliseconds)
      this.#waiters.add(wake)
    })
  }
  cancel(jobId: string): Job | Promise<Job> {
    const control = this.#jobs.get(jobId)
    if (!control) throw new WorkspaceError('TASK_UNKNOWN', '任务不存在')
    if (!control.controller) {
      if (!terminal.has(control.job.state) || control.live)
        return (this.#journal?.requestCancel(jobId) ?? Promise.resolve()).then(() => this.get(jobId))
      return this.get(jobId)
    }
    if (!terminal.has(control.job.state) || this.#previews.has(jobId)) {
      control.controller.abort()
      if (this.#previews.has(jobId)) control.job.state = 'cancelled'
      this.#notify()
    }
    return this.get(jobId)
  }
  async #run({ job, controller }: { job: Job; controller?: AbortController }): Promise<void> {
    if (!controller) throw new WorkspaceError('TASK_INVALID', '任务缺少控制信号')
    const signal = controller.signal
    const timeout = setTimeout(() => controller.abort(), 180000)
    let state = 'succeeded'
    let capture
    try {
      job.state = 'running'
      job.phase = 'preparing'
      this.#notify()
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
        if ((await this.workspace.revision({ contentOnly: true })) !== job.contentRevision)
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
        if (job.kind === 'preview' && job.result?.environmentLock) {
          const expected = job.result.environmentLock
          const actual = await this.workspace.read(expected.file)
          const revision = await this.workspace.revision({ contentOnly: true, excludeFile: expected.file })
          if (actual.version === expected.version && revision === job.preparationRevision)
            job.contentRevision = await this.workspace.revision({ contentOnly: true })
        }
        job.stale =
          job.kind === 'preview'
            ? (await this.workspace.revision({ contentOnly: true })) !== job.contentRevision ||
              !(await this.#dependenciesCurrent(job))
            : (await this.workspace.revision()) !== job.sourceRevision
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
      job.phase = state === 'succeeded' && job.kind === 'preview' ? 'ready' : 'finished'
      this.#notify()
    }
  }
  async #process(
    args: string[],
    job: Job,
    signal: AbortSignal,
    preview = false,
    capture: string | undefined = undefined,
  ): Promise<void> {
    if (signal.aborted) throw new WorkspaceError('TASK_CANCELLED', '任务已取消')
    const phases: Record<string, string> = {
      check: 'checking',
      build: 'building',
      pack: 'packing',
      preview: 'starting-preview',
      demo: 'running-demo',
    }
    job.phase = phases[args[1]] ?? 'testing'
    this.#notify()
    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.executable, args, {
        cwd: capture ?? this.workspace.root,
        env: {
          ...this.env,
          ELECTRON_RUN_AS_NODE: '1',
          ARCADIA_AUTHOR_RESULT: '1',
          ...(preview ? { ARCADIA_DEBUG_ENVIRONMENT: job.environmentId, ARCADIA_DEBUG_ROOT: this.workspace.root } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe', ...(preview ? ['ipc'] : [])] as import('node:child_process').StdioOptions,
        windowsHide: true,
        detached: process.platform !== 'win32',
      })
      let killTimer: ReturnType<typeof setTimeout> | undefined
      const kill = (force: boolean) => {
        try {
          if (child.pid === undefined) return
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
      const output = (text: string) => {
        if (!text) return
        job.outputCursor = outputRange(job).end + text.length
        job.output = (job.output + text).slice(-outputLimit)
        this.#notify()
        if (!preview || ready) return
        buffer += text
        let newline
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          if (!line.startsWith('ARCADIA_RESULT=')) continue
          try {
            const result = JSON.parse(line.slice('ARCADIA_RESULT='.length)) as JobResult
            if (!result.preview?.endpoint || signal.aborted) continue
            job.result = result
            ready = true
            resolve()
          } catch {
            /* Preserve incomplete or malformed output for diagnosis. */
          }
        }
      }
      let finished: () => void = () => {}
      if (preview)
        this.#previews.set(
          job.jobId,
          new Promise<void>(resolve => {
            finished = resolve
          }),
        )
      for (const stream of [child.stdout, child.stderr]) {
        if (!stream) continue
        const decoder = new StringDecoder('utf8')
        stream.on('data', (chunk: Buffer) => output(decoder.write(chunk)))
        stream.on('end', () => output(decoder.end()))
      }
      child.once('error', reject)
      child.once('close', code => {
        if (preview) {
          this.#previews.delete(job.jobId)
          const released = capture ? rm(capture, { recursive: true, force: true }) : Promise.resolve()
          void released.then(finished, (error: unknown) => {
            job.diagnostics.push(diagnostic(error))
            finished()
          })
          if (ready) {
            job.state = signal.aborted ? 'cancelled' : 'failed'
            this.#notify()
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
              job.result = JSON.parse(line.slice('ARCADIA_RESULT='.length)) as JobResult
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
  /** Stop previews owned by this host and wait for their processes and temporary files to be released. */
  async stopPreviews() {
    await this.#starting
    const previews = [...this.#jobs.values()].filter(({ job, controller }) => job.kind === 'preview' && controller)
    const released = [...this.#previews.values()]
    for (const { job } of previews) this.cancel(job.jobId)
    await Promise.allSettled(previews.map(control => control.done))
    await Promise.allSettled([...released, ...this.#previews.values()])
  }
  async close() {
    this.#closed = true
    this.#notify()
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
