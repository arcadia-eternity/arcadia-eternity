import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { mkdir, open, readdir, lstat, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { promisify } from 'node:util'
import { Parser } from 'tar'
import yauzl from 'yauzl'

const exec = promisify(execFile)
const fail = code => Object.assign(new Error(code), { code })
const forbidden = name =>
  ['.git', '.ssh', '.aws', '.npmrc', '.netrc', 'node_modules'].includes(name.toLowerCase()) ||
  /^\.env(?:\.|$)/i.test(name)
const safePath = value => {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 2048 ||
    value.includes('\\') ||
    /[\p{Cc}:]/u.test(value) ||
    isAbsolute(value)
  )
    throw fail('SOURCE_PATH_INVALID')
  const clean = value.replace(/\/$/, '').replace(/^\.\//, '')
  if (
    !clean ||
    clean
      .split('/')
      .some(
        part =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[. ]$/.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    throw fail('SOURCE_PATH_INVALID')
  return clean
}
const httpsUrl = value => {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw fail('SOURCE_URL_INVALID')
  return url
}
const publicUrl = value => {
  const url = httpsUrl(value)
  url.search = ''
  return url.href
}

function boundedFiles(options) {
  const names = new Set()
  const files = []
  let size = 0
  let entries = 0
  function track(name) {
    options.signal.throwIfAborted()
    name = safePath(name)
    if (++entries > options.maxFiles) throw fail('SOURCE_LIMIT')
    const key = name.normalize('NFC').toLowerCase()
    if (names.has(key)) throw fail('SOURCE_PATH_DUPLICATE')
    names.add(key)
    return name
  }
  return {
    files,
    directory: track,
    add(name, bytes) {
      name = track(name)
      if ((size += bytes.length) > options.maxBytes) throw fail('SOURCE_LIMIT')
      if (!name.split('/').some(forbidden)) files.push({ name, bytes })
    },
    checkSize(size) {
      if (!Number.isSafeInteger(size) || size < 0 || size > options.maxBytes) throw fail('SOURCE_LIMIT')
    },
  }
}
async function readBounded(stream, expectedSize, options) {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > options.maxBytes)
    throw fail('SOURCE_LIMIT')
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0,
      settled = false
    const finish = error => {
      if (settled) return
      settled = true
      options.signal.removeEventListener('abort', abort)
      if (error) {
        reject(error)
        stream.destroy()
      } else resolve(Buffer.concat(chunks, size))
    }
    const abort = () => finish(options.signal.reason ?? fail('SOURCE_CANCELLED'))
    options.signal.addEventListener('abort', abort, { once: true })
    stream.on('error', finish)
    stream.on('data', chunk => {
      if (settled) return
      size += chunk.length
      if (size > expectedSize || size > options.maxBytes) return finish(fail('SOURCE_LIMIT'))
      chunks.push(Buffer.from(chunk))
    })
    stream.on('end', () => finish(size === expectedSize ? undefined : fail('SOURCE_SIZE_CHANGED')))
    stream.on('close', () => {
      if (!settled) finish(fail('SOURCE_STREAM_CLOSED'))
    })
    if (options.signal.aborted) abort()
  })
}
async function tarFiles(file, options) {
  const output = boundedFiles(options)
  await new Promise((resolve, reject) => {
    const input = createReadStream(file)
    const parser = new Parser({ strict: true, maxMetaEntrySize: 64 * 1024, maxDecompressionRatio: 1000 })
    let failed = false
    const stop = error => {
      if (failed) return
      failed = true
      options.signal.removeEventListener('abort', abort)
      input.destroy()
      parser.abort(error)
      reject(error)
    }
    const abort = () => stop(options.signal.reason ?? fail('SOURCE_CANCELLED'))
    options.signal.addEventListener('abort', abort, { once: true })
    parser.on('entry', entry => {
      try {
        if (entry.type === 'Directory' && ['.', './'].includes(entry.path)) {
          entry.resume()
          return
        }
        const name = safePath(entry.path)
        if (entry.type === 'Directory') {
          output.directory(name)
          entry.resume()
          return
        }
        if (!['File', 'OldFile', 'ContiguousFile'].includes(entry.type)) throw fail('SOURCE_LINK_FORBIDDEN')
        output.checkSize(entry.size)
        const chunks = []
        let size = 0
        entry.on('data', chunk => {
          if (failed) return
          size += chunk.length
          if (size > entry.size || size > options.maxBytes) return stop(fail('SOURCE_LIMIT'))
          chunks.push(Buffer.from(chunk))
        })
        entry.on('end', () => {
          if (failed) return
          try {
            if (size !== entry.size) throw fail('SOURCE_SIZE_CHANGED')
            output.add(name, Buffer.concat(chunks, size))
          } catch (error) {
            stop(error)
          }
        })
        entry.on('error', stop)
        entry.resume()
      } catch (error) {
        stop(error)
      }
    })
    input.on('error', stop)
    parser.on('error', stop)
    parser.on('end', () => {
      options.signal.removeEventListener('abort', abort)
      if (!failed) resolve()
    })
    input.pipe(parser)
  })
  return output.files
}
async function zipFiles(file, options) {
  const output = boundedFiles(options)
  const zip = await new Promise((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, value) =>
      error ? reject(error) : resolve(value),
    ),
  )
  let abort
  try {
    await new Promise((resolve, reject) => {
      abort = () => {
        zip.close()
        reject(options.signal.reason ?? fail('SOURCE_CANCELLED'))
      }
      options.signal.addEventListener('abort', abort, { once: true })
      zip.on('error', reject)
      zip.on('end', () => {
        options.signal.removeEventListener('abort', abort)
        resolve()
      })
      zip.on('entry', entry => {
        void (async () => {
          const name = safePath(entry.fileName)
          const kind = (entry.externalFileAttributes >>> 16) & 0o170000
          if (kind !== 0 && kind !== 0o100000 && kind !== 0o040000) throw fail('SOURCE_LINK_FORBIDDEN')
          if (entry.generalPurposeBitFlag & 1) throw fail('SOURCE_ENCRYPTED_ARCHIVE')
          if (entry.fileName.endsWith('/')) {
            output.directory(name)
            zip.readEntry()
            return
          }
          output.checkSize(entry.uncompressedSize)
          const stream = await new Promise((resolve, reject) =>
            zip.openReadStream(entry, (error, value) => (error ? reject(error) : resolve(value))),
          )
          output.add(name, await readBounded(stream, entry.uncompressedSize, options))
          zip.readEntry()
        })().catch(error => {
          zip.close()
          reject(error)
        })
      })
      zip.readEntry()
    })
  } finally {
    options.signal.removeEventListener('abort', abort)
    zip.close()
  }
  return output.files
}
async function directoryFiles(directory, options) {
  const root = await realpath(directory)
  const output = boundedFiles(options)
  async function walk(path, prefix = '') {
    options.signal.throwIfAborted()
    const resolved = await realpath(path)
    const rel = relative(root, resolved)
    if ((rel && (isAbsolute(rel) || rel === '..' || rel.startsWith('../'))) || (await lstat(path)).isSymbolicLink())
      throw fail('SOURCE_LINK_FORBIDDEN')
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = prefix ? prefix + '/' + entry.name : entry.name
      safePath(name)
      if (forbidden(entry.name)) {
        output.directory(name)
        continue
      }
      const file = join(path, entry.name)
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw fail('SOURCE_LINK_FORBIDDEN')
      if (entry.isDirectory()) {
        output.directory(name)
        await walk(file, name)
      } else {
        const before = await lstat(file)
        if (!before.isFile()) throw fail('SOURCE_LINK_FORBIDDEN')
        output.checkSize(before.size)
        const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
        try {
          const actualPath = await realpath(file)
          const rel = relative(root, actualPath)
          if (isAbsolute(rel) || rel === '..' || rel.startsWith('../')) throw fail('SOURCE_LINK_FORBIDDEN')
          const bytes = await readBounded(handle.createReadStream({ autoClose: false }), before.size, options)
          const after = await handle.stat()
          if (before.ino !== after.ino || before.size !== bytes.length || before.mtimeMs !== after.mtimeMs)
            throw fail('SOURCE_CHANGED')
          output.add(name, bytes)
        } finally {
          await handle.close()
        }
      }
    }
  }
  await walk(root)
  return output.files
}
async function download(source, file, options) {
  let url = httpsUrl(source.url)
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetch(url, { redirect: 'manual', signal: options.signal })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      if (redirects === 5 || !response.headers.get('location')) throw fail('SOURCE_REDIRECT_LIMIT')
      url = httpsUrl(new URL(response.headers.get('location'), url).href)
      continue
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      throw fail('SOURCE_DOWNLOAD_FAILED')
    }
    const declared = response.headers.get('content-length')
    if (declared && Number(declared) > options.maxBytes) {
      await response.body.cancel()
      throw fail('SOURCE_LIMIT')
    }
    const chunks = []
    let total = 0
    for await (const chunk of response.body) {
      total += chunk.length
      if (total > options.maxBytes) {
        await response.body.cancel().catch(() => {})
        throw fail('SOURCE_LIMIT')
      }
      chunks.push(Buffer.from(chunk))
    }
    const bytes = Buffer.concat(chunks, total)
    if (source.integrity) {
      const tokens = source.integrity.trim().split(/\s+/)
      if (!tokens.length || tokens.some(token => !/^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(token)))
        throw fail('SOURCE_INTEGRITY_INVALID')
      if (
        !tokens.some(token => {
          const [algorithm, expected] = token.split('-')
          return createHash(algorithm).update(bytes).digest('base64') === expected
        })
      )
        throw fail('SOURCE_INTEGRITY_MISMATCH')
    }
    await writeFile(file, bytes, { flag: 'wx', mode: 0o600 })
    return {
      kind: 'url',
      url: publicUrl(source.url),
      resolvedUrl: publicUrl(url.href),
      ...(source.integrity ? { integrity: source.integrity } : {}),
    }
  }
  throw fail('SOURCE_REDIRECT_LIMIT')
}
async function gitArchive(source, root, options) {
  const url = httpsUrl(source.url).href
  if (typeof source.commit !== 'string' || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(source.commit))
    throw fail('SOURCE_GIT_COMMIT_REQUIRED')
  const artifactPath = source.artifactPath === undefined ? undefined : safePath(source.artifactPath)
  const gitRoot = join(root, 'git')
  const config = [
    '-c',
    'core.hooksPath=' + join(root, 'no-hooks'),
    '-c',
    'protocol.allow=never',
    '-c',
    'protocol.https.allow=always',
    '-c',
    'credential.helper=',
    '-c',
    'http.followRedirects=false',
  ]
  const env = {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot,
    HOME: root,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(root, 'no-config'),
    GIT_TERMINAL_PROMPT: '0',
  }
  const budget = new AbortController()
  const signal = AbortSignal.any([options.signal, budget.signal])
  let scanning = false
  async function checkBudget() {
    let size = 0,
      count = 0
    async function walk(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name)
        let info
        try {
          info = await lstat(file)
        } catch (error) {
          if (error.code === 'ENOENT') continue
          throw error
        }
        if (++count > options.maxFiles || (size += info.size) > options.maxBytes) throw fail('SOURCE_LIMIT')
        if (info.isDirectory()) await walk(file)
      }
    }
    await walk(root)
  }
  const timer = setInterval(() => {
    if (scanning) return
    scanning = true
    void checkBudget()
      .catch(error => budget.abort(error))
      .finally(() => {
        scanning = false
      })
  }, 100)
  timer.unref()
  const run = args =>
    exec('git', [...config, ...args], {
      env,
      signal,
      timeout: options.timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    })
  try {
    await run(['init', '--bare', gitRoot])
    await run(['--git-dir=' + gitRoot, 'fetch', '--no-tags', '--depth=1', '--', url, source.commit])
    await checkBudget()
    const actual = (await run(['--git-dir=' + gitRoot, 'rev-parse', 'FETCH_HEAD^{commit}'])).stdout.trim()
    if (actual.toLowerCase() !== source.commit.toLowerCase()) throw fail('SOURCE_GIT_COMMIT_MISMATCH')
    const file = join(root, 'git.tar')
    await run([
      '--git-dir=' + gitRoot,
      'archive',
      '--format=tar',
      '--output=' + file,
      artifactPath ? actual + ':' + artifactPath : actual,
    ])
    await checkBudget()
    return {
      file,
      provenance: { kind: 'git', url: publicUrl(url), commit: actual, ...(artifactPath ? { artifactPath } : {}) },
    }
  } catch (error) {
    if (budget.signal.aborted) throw budget.signal.reason
    if (options.signal.aborted) throw options.signal.reason
    if (typeof error.code === 'string' && error.code.startsWith('SOURCE_')) throw error
    throw fail('SOURCE_GIT_FAILED')
  } finally {
    clearInterval(timer)
  }
}

/** Only trusted host configuration supplies descriptors. HTTP callers select registered source IDs. */
export async function acquireSource(source, input) {
  if (
    !source ||
    typeof source !== 'object' ||
    !input ||
    typeof input.destination !== 'string' ||
    !isAbsolute(input.destination)
  )
    throw fail('SOURCE_INVALID')
  const timeoutMs = input.timeoutMs ?? 120000
  const options = {
    maxBytes: input.maxBytes ?? 256 * 1024 * 1024,
    maxFiles: input.maxFiles ?? 50000,
    timeoutMs,
    signal: AbortSignal.any([...(input.signal ? [input.signal] : []), AbortSignal.timeout(timeoutMs)]),
  }
  if (
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes < 1 ||
    !Number.isSafeInteger(options.maxFiles) ||
    options.maxFiles < 1
  )
    throw fail('SOURCE_LIMIT_INVALID')
  options.signal.throwIfAborted()
  await mkdir(input.destination, { mode: 0o700 })
  try {
    const scratch = join(input.destination, '.source')
    await mkdir(scratch)
    let files, provenance
    if (source.kind === 'directory') {
      if (typeof source.directory !== 'string' || !isAbsolute(source.directory)) throw fail('SOURCE_PATH_INVALID')
      files = await directoryFiles(source.directory, options)
      provenance = { kind: 'directory' }
    } else {
      let file
      if (source.kind === 'archive') {
        if (typeof source.file !== 'string' || !isAbsolute(source.file) || !(await lstat(source.file)).isFile())
          throw fail('SOURCE_ARCHIVE_INVALID')
        file = source.file
        provenance = { kind: 'archive' }
      } else if (source.kind === 'url') {
        file = join(scratch, 'download')
        provenance = await download(source, file, options)
      } else if (source.kind === 'git') {
        const result = await gitArchive(source, scratch, options)
        file = result.file
        provenance = result.provenance
      } else throw fail('SOURCE_KIND_UNSUPPORTED')
      if ((await lstat(file)).size > options.maxBytes) throw fail('SOURCE_LIMIT')
      const handle = await open(file, 'r')
      const magic = Buffer.alloc(4)
      try {
        await handle.read(magic, 0, 4, 0)
      } finally {
        await handle.close()
      }
      files = magic.readUInt32LE(0) === 0x04034b50 ? await zipFiles(file, options) : await tarFiles(file, options)
    }
    const packageFiles = files.filter(file => file.name === 'package.json' || file.name.endsWith('/package.json'))
    const rootManifest = packageFiles.find(file => file.name === 'package.json')
    const shortest =
      rootManifest ?? [...packageFiles].sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0]
    if (!shortest) throw fail('SOURCE_PACKAGE_MISSING')
    const prefix = shortest.name.slice(0, -'package.json'.length)
    if (!rootManifest && files.some(file => !file.name.startsWith(prefix))) throw fail('SOURCE_PACKAGE_AMBIGUOUS')
    const manifest = JSON.parse(shortest.bytes.toString('utf8'))
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') throw fail('SOURCE_PACKAGE_INVALID')
    const directory = join(input.destination, 'package')
    await mkdir(directory)
    for (const file of files) {
      options.signal.throwIfAborted()
      const name = safePath(file.name.slice(prefix.length))
      const output = join(directory, name)
      if (relative(directory, output).startsWith('..')) throw fail('SOURCE_PATH_INVALID')
      await mkdir(dirname(output), { recursive: true })
      await writeFile(output, file.bytes, { flag: 'wx', mode: 0o600 })
    }
    await rm(scratch, { recursive: true, force: true })
    return { directory, provenance: { ...provenance, name: manifest.name, version: manifest.version } }
  } catch (error) {
    await rm(input.destination, { recursive: true, force: true })
    if (typeof error.code === 'string' && error.code.startsWith('SOURCE_')) throw error
    if (options.signal.aborted) throw options.signal.reason
    throw fail('SOURCE_ACQUISITION_FAILED')
  }
}
