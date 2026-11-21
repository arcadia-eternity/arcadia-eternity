import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { isExactPackageSpec } from './content-library.mjs'

const protocol = 'arcadia.player-library/v1'
export const playerLibraryRoute = '/v1/player-library'
const fail = (code, message = code) => Object.assign(new Error(message), { code })
const record = value => value && typeof value === 'object' && !Array.isArray(value)
const exactFields = (value, names) => record(value) && Object.keys(value).every(key => names.includes(key))

async function restrictedDirectory(parent, name, modeMask) {
  const path = join(parent, name)
  await mkdir(path, { mode: 0o700 }).catch(error => {
    if (error.code !== 'EEXIST') throw error
  })
  const st = await lstat(path)
  if (
    !st.isDirectory() ||
    (await realpath(path)) !== path ||
    (process.getuid && (st.uid !== process.getuid() || (st.mode & modeMask) !== 0))
  )
    throw fail('PLAYER_LIBRARY_DISCOVERY_UNSAFE', '玩家库连接目录的所有者或访问权限无效')
  return path
}

async function installSource(source, kind) {
  if (exactFields(source, ['kind', 'spec']) && source.kind === 'npm' && isExactPackageSpec(source.spec)) return source
  if (
    exactFields(source, ['kind', 'file']) &&
    source.kind === 'archive' &&
    typeof source.file === 'string' &&
    isAbsolute(source.file) &&
    (kind === 'pack' ? /\.(?:tgz|zip)$/i : /\.tgz$/i).test(source.file)
  ) {
    const info = await lstat(source.file)
    if (info.isFile()) return { kind: 'archive', file: await realpath(source.file) }
  }
  throw fail(
    'INVALID_INSTALL_SOURCE',
    kind === 'pack' ? '请指定精确 npm 包版本、.tgz 或 .zip 文件' : '请指定精确 npm 包版本或 .tgz 文件',
  )
}

/** Only the existing main-process library owners can satisfy these operations. */
export function playerLibraryRequest({ id, label, library, environments }) {
  return async input => {
    if (!record(input)) throw fail('INVALID_REQUEST')
    if (input.operation === 'describe' && exactFields(input, ['operation'])) return { id, label }
    if (input.operation === 'list' && exactFields(input, ['operation', 'kind'])) {
      if (input.kind === 'pack') {
        const { packages } = await library.list()
        return { packages: packages.map(({ id, name, version, namespace }) => ({ id, name, version, namespace })) }
      }
      if (input.kind !== 'environment') throw fail('INVALID_REQUEST')
      const snapshot = await environments.snapshot()
      return {
        environments: snapshot.environments.map(({ document }) => ({
          id: document.id,
          name: document.name,
          selected: snapshot.selectedEnvironmentId === document.id,
        })),
        selectedEnvironmentId: snapshot.selectedEnvironmentId,
      }
    }
    if (
      input.operation !== 'install' ||
      !exactFields(input, ['operation', 'kind', 'source', 'offline', 'environmentId']) ||
      !['pack', 'environment'].includes(input.kind) ||
      (input.offline !== undefined && typeof input.offline !== 'boolean') ||
      (input.environmentId !== undefined &&
        (input.kind !== 'environment' ||
          typeof input.environmentId !== 'string' ||
          !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(input.environmentId) ||
          input.environmentId === 'default'))
    )
      throw fail('INVALID_REQUEST')
    const offline = input.offline !== false
    const source = await installSource(input.source, input.kind)
    if (input.kind === 'pack') {
      const id =
        source.kind === 'npm'
          ? await library.installNpm(source.spec, offline)
          : await library.installFile(source.file, offline)
      return { kind: 'pack', id }
    }
    const task = await environments.request(
      {
        action: 'install-recipe',
        source: source.kind === 'archive' ? { kind: 'file' } : source,
        allowDownload: !offline,
        environmentId: input.environmentId,
      },
      { chooseRecipeArchive: async () => source.file },
    )
    const installed = await environments.waitForOperation(task.operationId)
    return { kind: 'environment', id: installed.environmentId, name: installed.document.name }
  }
}

export function playerLibraryHttpHandler({ token, dispatch }) {
  const expected = Buffer.from('Bearer ' + token)
  return async (request, response) => {
    const send = (status, body) => {
      response.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end(JSON.stringify(body))
    }
    const supplied = Buffer.from(String(request.headers.authorization ?? ''))
    if (
      request.socket.remoteAddress !== '127.0.0.1' ||
      request.headers.host !== '127.0.0.1:' + request.socket.localPort ||
      request.headers.origin !== undefined ||
      request.headers['sec-fetch-site'] !== undefined ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      send(403, { error: { code: 'PLAYER_LIBRARY_UNAUTHORIZED', message: '玩家库连接未授权' } })
      return
    }
    if (
      request.url !== playerLibraryRoute ||
      request.method !== 'POST' ||
      request.headers['content-type']?.split(';')[0] !== 'application/json'
    ) {
      send(400, { error: { code: 'INVALID_REQUEST', message: '需要玩家库 JSON 操作' } })
      return
    }
    try {
      const chunks = []
      let length = 0
      for await (const chunk of request) {
        length += chunk.length
        if (length > 16 * 1024) throw fail('REQUEST_TOO_LARGE')
        chunks.push(chunk)
      }
      let input
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        throw fail('INVALID_REQUEST')
      }
      send(200, { result: await dispatch(input) })
    } catch (error) {
      if (!response.destroyed)
        send(400, {
          error: {
            code: typeof error.code === 'string' ? error.code : 'PLAYER_LIBRARY_FAILED',
            message: String(error.message).slice(0, 1024),
          },
        })
    }
  }
}

export async function registerPlayerLibrary({ home = homedir(), profile, label, port, library, environments }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail('PLAYER_LIBRARY_PORT_INVALID')
  const parent = await restrictedDirectory(await realpath(home), '.arcadia', 0o022)
  const directory = await restrictedDirectory(parent, 'player-libraries', 0o077)
  const id = createHash('sha256')
    .update(await realpath(profile))
    .digest('hex')
    .slice(0, 32)
  const file = join(directory, id + '.json')
  const token = randomBytes(32).toString('hex')
  const dispatch = playerLibraryRequest({ id, label, library, environments })
  let active = true
  const handle = playerLibraryHttpHandler({
    token,
    dispatch: input => {
      if (!active) throw fail('PLAYER_LIBRARY_CLOSED')
      return dispatch(input)
    },
  })
  const temporary = file + '.' + randomBytes(8).toString('hex')
  const descriptor = { protocol, id, label, pid: process.pid, port, token }
  try {
    await writeFile(temporary, JSON.stringify(descriptor) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true })
  }
  return {
    handle,
    async close() {
      active = false
      // An already-started replacement owns its own credential and descriptor.
      try {
        if (JSON.parse(await readFile(file, 'utf8')).token === token) await rm(file)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    },
  }
}
