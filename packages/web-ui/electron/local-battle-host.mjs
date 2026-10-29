import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const worker = fileURLToPath(new URL('./local-battle-worker.mjs', import.meta.url))

export class LocalBattleHostError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'LocalBattleHostError'
    this.code = code
  }
}
const problem = (code, message) => new LocalBattleHostError(code, message)

/** Don't forward the desktop process's account tokens or arbitrary Node options. */
export function workerEnvironment(cache, npmCliPath, packsDirectory) {
  const result = {}
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG']) {
    if (process.env[key]) result[key] = process.env[key]
  }
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
  result[pathKey] = process.env[pathKey] ?? process.env.PATH ?? ''
  return {
    ...result,
    ...(npmCliPath ? { ARCADIA_NPM_CLI: npmCliPath } : {}),
    ...(packsDirectory ? { ARCADIA_PACKS_DIR: packsDirectory } : {}),
    TMPDIR: cache,
    TMP: cache,
    TEMP: cache,
    ARCADIA_DESKTOP_TEMP: cache,
    ELECTRON_RUN_AS_NODE: '1',
    ACCOUNT_MODE: 'guest',
    DOTENV_CONFIG_PATH: join(cache, 'no-dotenv'),
    npm_config_cache: join(cache, 'npm-cache'),
    npm_config_userconfig: join(cache, 'no-user-npmrc'),
    npm_config_globalconfig: join(cache, 'no-global-npmrc'),
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  }
}

async function verifyProject(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory))
    throw problem('PROJECT_INVALID', '请选择本机服务器项目目录')
  try {
    if (!(await stat(directory)).isDirectory()) throw new Error()
    for (const name of ['package.json', 'arcadia-admission.json'])
      if (!(await stat(join(directory, name))).isFile()) throw new Error()
    if (!(await stat(join(directory, 'node_modules'))).isDirectory()) throw new Error()
    try {
      if (!(await stat(join(directory, 'npm-shrinkwrap.json'))).isFile()) throw new Error()
    } catch {
      if (!(await stat(join(directory, 'package-lock.json'))).isFile()) throw new Error()
    }
  } catch {
    throw problem('PROJECT_NOT_READY', '项目需要已安装依赖、npm 锁文件和明确的代码准入记录')
  }
}

function verifyReady(port, serverId) {
  return new Promise((resolve, reject) => {
    const request = get(`http://127.0.0.1:${port}/api/v1/server-info`, { timeout: 4000 }, response => {
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error('Invalid status'))
        return
      }
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
        if (body.length > 16384) request.destroy(new Error('Response too large'))
      })
      response.on('end', () => {
        try {
          if (JSON.parse(body).serverId !== serverId) throw new Error('Incorrect server identity')
          resolve()
        } catch (error) {
          reject(error)
        }
      })
    })
    request.on('timeout', () => request.destroy(new Error('Health check timeout')))
    request.on('error', reject)
  })
}

/** One selected, already installed and approved project runs in a child process.
 * No renderer argument controls the executable, network interface, or shell command.
 */
export class LocalBattleHost {
  #state = { status: 'idle' }
  #child
  #closed
  #stopping
  #generation = 0
  #projectDirectory
  constructor({
    executable,
    cli,
    rendererOrigin,
    npmCliPath,
    packsDirectory,
    startupTimeoutMs = 60000,
    shutdownTimeoutMs = 5000,
  }) {
    this.executable = executable
    this.cli = cli
    this.rendererOrigin = rendererOrigin
    this.npmCliPath = npmCliPath
    this.packsDirectory = packsDirectory
    this.startupTimeoutMs = startupTimeoutMs
    this.shutdownTimeoutMs = shutdownTimeoutMs
  }
  status() {
    return { ...this.#state }
  }
  projectDirectory() {
    return this.#child ? this.#projectDirectory : undefined
  }
  /** Last resort during application shutdown; the child is already unresponsive. */
  forceStop() {
    ++this.#generation
    this.#child?.kill('SIGKILL')
  }
  async start(directory, { builtinOnly = false } = {}) {
    if (this.#child || ['starting', 'stopping', 'running'].includes(this.#state.status))
      throw problem('HOST_BUSY', '本机对战服务已经启动或正在启动')
    const generation = ++this.#generation
    this.#state = { status: 'starting' }
    let cache, spawnedChild
    try {
      try {
        await access(this.executable, constants.X_OK)
      } catch {
        throw problem('SERVER_RUNTIME_MISSING', '未找到本机对战服务运行程序')
      }
      try {
        await access(this.cli, constants.R_OK)
      } catch {
        throw problem('SERVER_RUNTIME_MISSING', '未找到打包的本机对战服务运行文件')
      }
      if (this.npmCliPath !== undefined) {
        try {
          if (!isAbsolute(this.npmCliPath) || !(await stat(this.npmCliPath)).isFile()) throw new Error()
          await access(this.npmCliPath, constants.R_OK)
        } catch {
          throw problem('NPM_RUNTIME_MISSING', '未找到打包的 npm 检查运行工具')
        }
      }
      if (this.packsDirectory !== undefined) {
        try {
          if (!isAbsolute(this.packsDirectory) || !(await stat(this.packsDirectory)).isDirectory()) throw new Error()
          if (!(await stat(join(this.packsDirectory, 'base', 'pack.json'))).isFile()) throw new Error()
          await access(join(this.packsDirectory, 'base', 'pack.json'), constants.R_OK)
        } catch {
          throw problem('BASE_PACK_MISSING', '未找到打包的官方基础内容')
        }
      }
      await verifyProject(directory)
      const projectDirectory = await realpath(directory)
      cache = await mkdtemp(join(tmpdir(), 'arcadia-desktop-server-'))
      if (generation !== this.#generation) throw problem('HOST_STOPPED', '本机对战服务已停止')
      const serverId = `arcadia-desktop-${randomUUID()}`
      const child = spawn(
        this.executable,
        [
          worker,
          this.cli,
          'server',
          '--host',
          '127.0.0.1',
          '--port',
          '0',
          '--server-id',
          serverId,
          '--cors-origin',
          this.rendererOrigin,
          ...(builtinOnly ? [] : ['--npm-project', directory]),
        ],
        {
          cwd: cache,
          env: workerEnvironment(cache, this.npmCliPath, this.packsDirectory),
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          windowsHide: true,
        },
      )
      spawnedChild = child
      this.#child = child
      this.#projectDirectory = projectDirectory
      const done = new Promise(resolve => {
        child.once('close', (code, signal) => resolve({ code, signal }))
      }).then(async result => {
        await rm(cache, { recursive: true, force: true })
        return result
      })
      this.#closed = done
      void done.then(async ({ code, signal }) => {
        if (this.#child === child) {
          this.#child = undefined
          this.#closed = undefined
          if (this.#state.status === 'running')
            this.#state = {
              status: 'failed',
              code: 'SERVER_EXITED',
              message: `本机对战服务已退出（${code ?? signal ?? 'unknown'}）`,
            }
        }
      })
      // UGC output is not safe to expose to the renderer. Recognize only fixed
      // diagnostics from the host and discard the actual text.
      let stderr = ''
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', chunk => {
        stderr = (stderr + chunk).slice(-8192)
      })
      const port = await new Promise((resolve, reject) => {
        let buffer = '',
          settled = false,
          checking = false
        const finish = (error, value) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          if (error) reject(error)
          else resolve(value)
        }
        const timeout = setTimeout(
          () => finish(problem('SERVER_START_TIMEOUT', '本机对战服务准备超时')),
          this.startupTimeoutMs,
        )
        child.once('error', () => finish(problem('SERVER_START_FAILED', '无法启动本机对战服务')))
        child.once('close', () => {
          if (stderr.includes('Expected an explicit npm project approval'))
            finish(problem('NPM_NOT_APPROVED', '项目缺少有效的代码准入记录'))
          else if (/spawn npm ENOENT/.test(stderr))
            finish(problem('NPM_RUNTIME_MISSING', '未找到可运行的 npm 检查工具'))
          else if (stderr.includes('npm rejected the installed dependency tree'))
            finish(problem('NPM_DEPENDENCIES_INVALID', '项目依赖不完整或与锁文件不一致'))
          else finish(problem('SERVER_START_FAILED', '本机对战服务准备失败，请检查已安装依赖和代码准入'))
        })
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', chunk => {
          if (checking || settled) return
          buffer = (buffer + chunk).slice(-8192)
          const line = `Battle server ${serverId} listening on port `
          const start = buffer.indexOf(line)
          if (start < 0) return
          const match = buffer.slice(start + line.length).match(/^(\d+)\r?\n/)
          if (!match) return
          const port = Number(match[1])
          if (!Number.isInteger(port) || port < 1 || port > 65535)
            return finish(problem('SERVER_START_FAILED', '本机端口无效'))
          checking = true
          void verifyReady(port, serverId).then(
            () => finish(null, port),
            () => finish(problem('SERVER_START_FAILED', '本机对战服务就绪检查失败')),
          )
        })
      })
      if (generation !== this.#generation || this.#child !== child) throw problem('HOST_STOPPED', '本机对战服务已停止')
      this.#state = { status: 'running', url: `http://127.0.0.1:${port}`, serverId, projectName: basename(directory) }
      return this.status()
    } catch (error) {
      const wasCurrent = generation === this.#generation
      if (spawnedChild && this.#child === spawnedChild) await this.stop()
      else if (!spawnedChild && cache) await rm(cache, { recursive: true, force: true })
      const failure =
        error instanceof LocalBattleHostError ? error : problem('SERVER_START_FAILED', '无法启动本机对战服务')
      if (wasCurrent && (generation === this.#generation || generation + 1 === this.#generation))
        this.#state = { status: 'failed', code: failure.code, message: failure.message }
      throw failure
    }
  }
  async stop() {
    if (this.#stopping) return this.#stopping
    const generation = ++this.#generation
    const child = this.#child,
      done = this.#closed
    if (!child || !done) {
      this.#state = { status: 'idle' }
      return this.status()
    }
    this.#state = { status: 'stopping' }
    const stopping = (async () => {
      child.kill('SIGTERM')
      let timer
      try {
        const exited = await Promise.race([
          done.then(() => true),
          new Promise(resolve => {
            timer = setTimeout(() => resolve(false), this.shutdownTimeoutMs)
          }),
        ])
        if (!exited) {
          child.kill('SIGKILL')
          let killTimer
          try {
            await Promise.race([
              done,
              new Promise((_, reject) => {
                killTimer = setTimeout(
                  () => reject(problem('HOST_STOP_FAILED', '本机对战服务未能退出')),
                  this.shutdownTimeoutMs,
                )
              }),
            ])
          } finally {
            clearTimeout(killTimer)
          }
        }
      } finally {
        clearTimeout(timer)
      }
      if (generation === this.#generation) {
        if (this.#child === child) this.#child = undefined
        this.#closed = undefined
        this.#state = { status: 'idle' }
      }
      return this.status()
    })()
    this.#stopping = stopping
    try {
      return await stopping
    } finally {
      if (this.#stopping === stopping) this.#stopping = undefined
    }
  }
}
