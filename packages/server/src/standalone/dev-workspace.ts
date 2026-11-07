import { constants } from 'node:fs'
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'

const MAX_BYTES = 2 * 1024 * 1024
// Editor revisions cover the content and the metadata used to construct references.
const digest = (data: Uint8Array, project: unknown) =>
  createHash('sha256').update(JSON.stringify(project)).update('\0').update(data).digest('hex')
export class DevelopmentError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}
function fail(code: string, status: number): never {
  throw new DevelopmentError(code, status)
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Restricted to the administrator-selected package root and its two fixed filenames. */
export class DevelopmentWorkspace {
  private readonly root: string
  private readonly tokenHash: Buffer
  private rootIdentity?: { dev: number; ino: number }
  constructor(directory: string, token: string) {
    if (!isAbsolute(directory) || typeof token !== 'string' || token.length < 32 || token.length > 256)
      throw new Error('Development workspace requires an absolute directory and a 32–256 character administrator token')
    this.root = resolve(directory)
    this.tokenHash = createHash('sha256').update(token).digest()
  }
  authorize(value: string | undefined) {
    const candidate = createHash('sha256')
      .update(value ?? '')
      .digest()
    if (!value || !timingSafeEqual(candidate, this.tokenHash)) fail('DEVELOPMENT_UNAUTHORIZED', 401)
  }
  private async checkRoot() {
    const info = await lstat(this.root)
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(this.root)) !== this.root)
      fail('DEVELOPMENT_PATH', 400)
    if (this.rootIdentity && (this.rootIdentity.dev !== info.dev || this.rootIdentity.ino !== info.ino))
      fail('DEVELOPMENT_CHANGED', 409)
    this.rootIdentity ??= { dev: info.dev, ino: info.ino }
  }
  private async readFile(name: 'package.json' | 'content.json') {
    await this.checkRoot()
    const file = join(this.root, name)
    let before
    try {
      before = await lstat(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fail('DEVELOPMENT_FILE', 400)
      throw error
    }
    if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_BYTES) fail('DEVELOPMENT_FILE', 400)
    let handle
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch (error) {
      if (['ENOENT', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? ''))
        return fail('DEVELOPMENT_CHANGED', 409)
      throw error
    }
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.size > MAX_BYTES)
        fail('DEVELOPMENT_CHANGED', 409)
      const bytes = await handle.readFile()
      const after = await handle.stat()
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs)
        fail('DEVELOPMENT_CHANGED', 409)
      await this.checkRoot()
      return bytes
    } finally {
      await handle.close()
    }
  }
  async read() {
    const packageBytes = await this.readFile('package.json')
    let packageData: unknown
    try {
      packageData = JSON.parse(packageBytes.toString('utf8'))
    } catch {
      return fail('DEVELOPMENT_PACKAGE', 400)
    }
    const arcadia = record(packageData) && record(packageData.arcadia) ? packageData.arcadia : null
    if (
      !arcadia ||
      typeof arcadia.projectId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(arcadia.projectId) ||
      typeof arcadia.namespace !== 'string' ||
      !/^[a-z0-9][a-z0-9_.-]{0,79}$/.test(arcadia.namespace) ||
      arcadia.content !== 'content.json'
    )
      fail('DEVELOPMENT_PACKAGE', 400)
    const bytes = await this.readFile('content.json')
    if (!packageBytes.equals(await this.readFile('package.json')) || !bytes.equals(await this.readFile('content.json')))
      fail('DEVELOPMENT_CHANGED', 409)
    let content: unknown
    try {
      content = JSON.parse(bytes.toString('utf8'))
    } catch {
      return fail('DEVELOPMENT_CONTENT', 400)
    }
    if (!record(content)) fail('DEVELOPMENT_CONTENT', 400)
    const project = {
      projectId: arcadia.projectId,
      namespace: arcadia.namespace,
    }
    return { revision: digest(bytes, project), content, project }
  }

  async write(revision: unknown, content: unknown) {
    if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision) || !record(content))
      fail('DEVELOPMENT_REQUEST', 400)
    const bytes = Buffer.from(JSON.stringify(content, null, 2) + '\n')
    if (bytes.length > MAX_BYTES) fail('DEVELOPMENT_LIMIT', 413)
    await this.checkRoot()
    const lockPath = join(this.root, '.arcadia-content.lock')
    let lock
    try {
      lock = await open(lockPath, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return fail('DEVELOPMENT_BUSY', 409)
      throw error
    }
    const temp = join(this.root, `.arcadia-content-${randomUUID()}.tmp`)
    try {
      const current = await this.read()
      if (current.revision !== revision) fail('REVISION_CONFLICT', 409)
      const source = await lstat(join(this.root, 'content.json'))
      if (!source.isFile() || source.isSymbolicLink()) fail('DEVELOPMENT_CHANGED', 409)
      const handle = await open(temp, 'wx', 0o600)
      try {
        await handle.writeFile(bytes)
        await handle.chmod(source.mode & 0o777)
        await handle.sync()
      } finally {
        await handle.close()
      }
      const latest = await this.read()
      if (latest.revision !== revision || JSON.stringify(latest.project) !== JSON.stringify(current.project))
        fail('REVISION_CONFLICT', 409)
      await rename(temp, join(this.root, 'content.json'))
      return { revision: digest(bytes, current.project), content, project: current.project }
    } finally {
      await unlink(temp).catch(() => undefined)
      await lock.close()
      await unlink(lockPath)
    }
  }
}
