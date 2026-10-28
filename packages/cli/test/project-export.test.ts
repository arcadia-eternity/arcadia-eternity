import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { promisify } from 'node:util'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createGzip, gzipSync } from 'node:zlib'
import { Command } from 'commander'
import { inspectNpmProject } from '@arcadia-eternity/pack-loader/node'
import { exportProject, verifyProject } from '../src/commands/project'
import { registerCommands } from '../src/commands/register'

const exec = promisify(execFile)
const workspace = resolve(import.meta.dirname, '../../..')
let temporary: string, source: string, cache: string, installedDigest: string
const originalCache = process.env.npm_config_cache
vi.setConfig({ testTimeout: 60000 })

async function npm(cwd: string, args: string[]) {
  return exec('npm', [...args, '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], {
    cwd,
    env: { ...process.env, npm_config_cache: cache },
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  })
}
async function approval(directory: string, profile = 'local-development') {
  await writeFile(
    join(directory, 'arcadia-admission.json'),
    JSON.stringify({
      format: 'arcadia.npm-admission',
      version: 2,
      profile,
    }),
  )
}
async function json(file: string) {
  return JSON.parse(await readFile(file, 'utf8'))
}
async function writeJson(file: string, value: unknown) {
  await writeFile(file, JSON.stringify(value, null, 2) + '\n')
}
async function copySource(name: string) {
  const destination = join(temporary, name)
  await cp(source, destination, { recursive: true, verbatimSymlinks: true })
  return destination
}
async function exists(path: string) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function maliciousTar(name: string, type: '0' | '2', linkname = '', prefixZeros = 0) {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write('0000644\0', 100, 8, 'ascii')
  header.write('0000000\0', 108, 8, 'ascii')
  header.write('0000000\0', 116, 8, 'ascii')
  header.write('00000000000\0', 124, 12, 'ascii')
  header.write('00000000000\0', 136, 12, 'ascii')
  header.fill(32, 148, 156)
  header.write(type, 156, 1, 'ascii')
  header.write(linkname, 157, 100, 'utf8')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  const checksum = header.reduce((sum, value) => sum + value, 0)
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
  return gzipSync(Buffer.concat([Buffer.alloc(prefixZeros), header, Buffer.alloc(1024)]))
}

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'arcadia-project-export-'))
  source = join(temporary, 'original')
  cache = join(temporary, 'npm-cache')
  await mkdir(source)
  await mkdir(join(source, 'artifacts'))
  process.env.npm_config_cache = cache
  await exec(
    process.execPath,
    [join(workspace, 'node_modules/typescript/bin/tsc'), '-p', join(workspace, 'examples/ugc/slow/tsconfig.json')],
    { cwd: workspace, timeout: 30000 },
  )
  const packed = await exec(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', join(source, 'artifacts')],
    {
      cwd: join(workspace, 'examples/ugc/slow'),
      env: { ...process.env, npm_config_cache: cache },
      timeout: 30000,
    },
  )
  const tarball = JSON.parse(packed.stdout)[0].filename as string
  await writeJson(join(source, 'package.json'), {
    name: 'private-server',
    version: '1.0.0',
    private: true,
    dependencies: { '@arcadia-example/slow': `file:artifacts/${tarball}` },
    scripts: { preinstall: 'echo PRIVATE_SENSITIVE_PROJECT_SCRIPT' },
    privateConfig: 'PRIVATE_SENSITIVE_PROJECT_CONFIG',
  })
  await writeFile(join(source, '.npmrc'), '//registry.npmjs.org/:_authToken=PRIVATE_SENSITIVE_NPM_TOKEN\n')
  await writeFile(join(source, '.env'), 'PRIVATE_SENSITIVE_ENV=example\n')
  await writeFile(join(source, 'accounts.json'), 'PRIVATE_SENSITIVE_ACCOUNT')
  await npm(source, ['install'])
  installedDigest = (await inspectNpmProject(source)).digest
  await approval(source)
}, 60000)
afterAll(async () => {
  if (originalCache === undefined) delete process.env.npm_config_cache
  else process.env.npm_config_cache = originalCache
  if (temporary) await rm(temporary, { recursive: true, force: true })
})

it('requires an explicit grant to share approved local artifacts and does not create output on refusal', async () => {
  const output = join(temporary, 'not-authorized')
  await expect(exportProject(source, output, false)).rejects.toMatchObject({ code: 'PROJECT_LOCAL_PERMISSION' })
  expect(await exists(output)).toBe(false)
})

it('requires a source admission record and leaves no output when it is absent', async () => {
  const dir = await copySource('unapproved-source')
  await rm(join(dir, 'arcadia-admission.json'))
  const output = join(temporary, 'unapproved-output')
  await expect(exportProject(dir, output, true)).rejects.toThrow()
  expect(await exists(output)).toBe(false)
})

it('reports errors in locally edited code without revoking project approval or creating output', async () => {
  const dir = await copySource('changed-unapproved-source')
  await writeFile(
    join(dir, 'node_modules/@arcadia-example/slow/dist/effects.js'),
    "throw new Error('LOCAL_CODE_EXECUTED')\n",
  )
  const output = join(temporary, 'changed-unapproved-output')
  await expect(exportProject(dir, output, true)).rejects.toThrow('LOCAL_CODE_EXECUTED')
  expect(await exists(output)).toBe(false)
})

it('registers the portable export through the actual CLI command tree', async () => {
  const output = join(temporary, 'cli-project')
  let stdout = ''
  const program = new Command().exitOverride()
  registerCommands(program, {
    cwd: temporary,
    signal: new AbortController().signal,
    stdout: async text => {
      stdout += text
    },
    stderr: async () => {},
  })
  await program.parseAsync(['content', 'project', 'export', source, output, '--include-local-artifacts', '--json'], {
    from: 'user',
  })
  expect(JSON.parse(stdout)).toMatchObject({
    format: 'arcadia.deployment-project',
    installationDigest: installedDigest,
  })
  expect(await exists(join(output, 'arcadia-admission.json'))).toBe(false)
})

it('exports only shareable files, rebuilds offline in a clean host, and verifies the separately approved fixed environment', async () => {
  const output = join(temporary, 'portable')
  const exported = await exportProject(source, output, true)
  expect(exported.installationDigest).toBe(installedDigest)
  expect(exported.revision).toMatch(/^arcadia\.work-environment\/1:/)
  expect((await readdir(output)).sort()).toEqual([
    'README.md',
    'arcadia-deployment.json',
    'artifacts',
    'package-lock.json',
    'package.json',
  ])
  const files = await Promise.all(
    ['README.md', 'arcadia-deployment.json', 'package-lock.json', 'package.json'].map(file =>
      readFile(join(output, file), 'utf8'),
    ),
  )
  for (const contents of files) {
    expect(contents).not.toContain(temporary)
    expect(contents).not.toContain('PRIVATE_SENSITIVE')
    expect(contents).not.toContain('private-server')
  }
  expect(await exists(join(output, 'node_modules'))).toBe(false)
  expect(await exists(join(output, 'arcadia-admission.json'))).toBe(false)
  const artifacts = await readdir(join(output, 'artifacts'))
  expect(artifacts).toHaveLength(1)
  expect(artifacts[0]).toMatch(/^[a-f0-9]{64}\.tgz$/)
  const fresh = join(temporary, 'clean-host')
  await cp(output, fresh, { recursive: true })
  await npm(fresh, ['ci', '--omit=dev'])
  expect((await inspectNpmProject(fresh)).digest).toBe(installedDigest)
  await expect(verifyProject(fresh)).rejects.toThrow()
  await approval(fresh, 'self-hosted')
  await expect(verifyProject(fresh)).rejects.toMatchObject({ code: 'PROJECT_POLICY' })
  await approval(fresh)
  expect(await verifyProject(fresh)).toMatchObject({
    verified: true,
    revision: exported.revision,
    installationDigest: installedDigest,
  })
  const artifact = join(fresh, 'artifacts', artifacts[0])
  const originalArtifact = await readFile(artifact)
  await writeFile(artifact, 'modified after installation')
  await expect(verifyProject(fresh)).rejects.toMatchObject({ code: 'PROJECT_INTEGRITY' })
  await writeFile(artifact, originalArtifact)
  await rename(join(fresh, 'artifacts'), join(fresh, 'actual-artifacts'))
  await symlink(
    process.platform === 'win32' ? join(fresh, 'actual-artifacts') : 'actual-artifacts',
    join(fresh, 'artifacts'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  await expect(verifyProject(fresh)).rejects.toMatchObject({ code: 'PROJECT_SOURCE' })
  await rm(join(fresh, 'artifacts'))
  await rename(join(fresh, 'actual-artifacts'), join(fresh, 'artifacts'))
  const lockfile = join(fresh, 'package-lock.json'),
    original = await readFile(lockfile, 'utf8')
  await writeFile(lockfile, original + ' ')
  await expect(verifyProject(fresh)).rejects.toMatchObject({ code: 'PROJECT_CHANGED' })
  await writeFile(lockfile, original)
  await rm(join(fresh, 'node_modules/@arcadia-example/slow'), { recursive: true })
  await expect(verifyProject(fresh)).rejects.toThrow()
}, 60000)

it('refuses to overwrite a directory and preserves its contents', async () => {
  const output = join(temporary, 'occupied')
  await mkdir(output)
  await writeFile(join(output, 'keep.txt'), 'do not overwrite')
  await expect(exportProject(source, output, true)).rejects.toMatchObject({ code: 'OUTPUT_EXISTS' })
  expect(await readFile(join(output, 'keep.txt'), 'utf8')).toBe('do not overwrite')
})

it('rejects tampered tarball bytes before creating output', async () => {
  const dir = await copySource('tampered-source')
  const tarball = (await readdir(join(dir, 'artifacts')))[0]
  await writeFile(join(dir, 'artifacts', tarball), 'not the original artifact')
  const output = join(temporary, 'tampered-output')
  await expect(exportProject(dir, output, true)).rejects.toMatchObject({ code: 'PROJECT_INTEGRITY' })
  expect(await exists(output)).toBe(false)
})

it('exports the retained artifact without policing local code file edits', async () => {
  const dir = await copySource('locally-modified-installation')
  const compiled = join(dir, 'node_modules/@arcadia-example/slow/dist/effects.js')
  await writeFile(compiled, (await readFile(compiled, 'utf8')) + '\n// approved local modification\n')
  const output = join(temporary, 'modified-installation-output')
  expect((await exportProject(dir, output, true)).installationDigest).toBe(installedDigest)
  expect(await exists(join(output, 'arcadia-deployment.json'))).toBe(true)
})

it.each([
  ['path traversal', '../../outside', '0', '', 0],
  ['symlink', 'package/link', '2', '../../outside', 0],
  ['entry after end marker', 'package/late', '0', '', 1024],
  ['Windows alternate stream', 'package/file:secret', '0', '', 0],
  ['Windows device name', 'package/CON', '0', '', 0],
] as const)(
  'rejects an SRI-matching archive containing %s before export',
  async (scenario, name, type, linkname, prefixZeros) => {
    const suffix = scenario.replaceAll(' ', '-')
    const dir = await copySource(`archive-${suffix}`)
    const tarball = (await readdir(join(dir, 'artifacts')))[0]
    const bytes = maliciousTar(name, type, linkname, prefixZeros)
    await writeFile(join(dir, 'artifacts', tarball), bytes)
    const lockfile = join(dir, 'package-lock.json')
    const lock = await json(lockfile)
    lock.packages['node_modules/@arcadia-example/slow'].integrity =
      `sha512-${createHash('sha512').update(bytes).digest('base64')}`
    await writeJson(lockfile, lock)
    await approval(dir)
    const output = join(temporary, `archive-output-${suffix}`)
    await expect(exportProject(dir, output, true)).rejects.toMatchObject({ code: 'PROJECT_ARCHIVE' })
    expect(await exists(output)).toBe(false)
  },
  60000,
)

it('requires an unauthenticated public registry probe and can rebuild its pinned artifact from a populated offline cache', async () => {
  const dir = await copySource('public-registry-source')
  const manifest = await json(join(dir, 'package.json'))
  const lock = await json(join(dir, 'package-lock.json'))
  const name = '@arcadia-example/slow'
  const url = 'https://registry.npmjs.org/@arcadia-example/slow/-/slow-1.0.0.tgz'
  manifest.dependencies[name] = '1.0.0'
  lock.packages[''].dependencies[name] = '1.0.0'
  lock.packages[`node_modules/${name}`].resolved = url
  await writeJson(join(dir, 'package.json'), manifest)
  await writeJson(join(dir, 'package-lock.json'), lock)
  const denied = vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch
  const unavailable = join(temporary, 'unavailable-public-output')
  await expect(exportProject(dir, unavailable, false, denied)).rejects.toMatchObject({ code: 'PROJECT_UNAVAILABLE' })
  expect(await exists(unavailable)).toBe(false)
  const probe = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch
  const output = join(temporary, 'public-registry-output')
  const exported = await exportProject(dir, output, false, probe)
  expect(probe).toHaveBeenCalledOnce()
  const [requested, options] = vi.mocked(probe).mock.calls[0]
  expect(String(requested)).toBe(url)
  expect(options).toMatchObject({ method: 'HEAD', redirect: 'manual', credentials: 'omit' })
  expect(options?.headers).toBeUndefined()
  expect(await exists(join(output, 'artifacts'))).toBe(false)
  await npm(output, ['ci', '--omit=dev'])
  expect((await inspectNpmProject(output)).digest).toBe(installedDigest)
  await approval(output)
  expect(await verifyProject(output)).toMatchObject({ verified: true, revision: exported.revision })
}, 60000)

it('rejects a small SRI-matching compressed archive whose expansion exceeds the size budget', async () => {
  const dir = await copySource('archive-bomb')
  const tarball = (await readdir(join(dir, 'artifacts')))[0]
  const gzip = createGzip()
  const chunks: Buffer[] = []
  gzip.on('data', (chunk: Buffer) => chunks.push(chunk))
  const ended = once(gzip, 'end')
  const block = Buffer.alloc(1024 * 1024)
  for (let index = 0; index < 129; index++) if (!gzip.write(block)) await once(gzip, 'drain')
  gzip.end()
  await ended
  const bytes = Buffer.concat(chunks)
  expect(bytes.length).toBeLessThan(1024 * 1024)
  await writeFile(join(dir, 'artifacts', tarball), bytes)
  const lockfile = join(dir, 'package-lock.json')
  const lock = await json(lockfile)
  lock.packages['node_modules/@arcadia-example/slow'].integrity =
    `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  await writeJson(lockfile, lock)
  await approval(dir)
  const output = join(temporary, 'archive-bomb-output')
  await expect(exportProject(dir, output, true)).rejects.toMatchObject({ code: 'PROJECT_ARCHIVE' })
  expect(await exists(output)).toBe(false)
}, 60000)

it('rejects local tarball references outside the explicitly selected source project', async () => {
  const dir = await copySource('outside-source')
  const tarball = (await readdir(join(dir, 'artifacts')))[0]
  await cp(join(dir, 'artifacts', tarball), join(temporary, 'outside.tgz'))
  const manifest = await json(join(dir, 'package.json')),
    lock = await json(join(dir, 'package-lock.json'))
  manifest.dependencies['@arcadia-example/slow'] = 'file:../outside.tgz'
  lock.packages[''].dependencies['@arcadia-example/slow'] = 'file:../outside.tgz'
  lock.packages['node_modules/@arcadia-example/slow'].resolved = 'file:../outside.tgz'
  await writeJson(join(dir, 'package.json'), manifest)
  await writeJson(join(dir, 'package-lock.json'), lock)
  await npm(dir, ['ci', '--omit=dev'])
  await approval(dir)
  const output = join(temporary, 'outside-output')
  await expect(exportProject(dir, output, true)).rejects.toMatchObject({ code: 'PROJECT_SOURCE' })
  expect(await exists(output)).toBe(false)
})

it('rejects a local artifact reached through a symlinked directory', async () => {
  const dir = await copySource('symlink-source')
  await rename(join(dir, 'artifacts'), join(dir, 'actual-artifacts'))
  await symlink(
    process.platform === 'win32' ? join(dir, 'actual-artifacts') : 'actual-artifacts',
    join(dir, 'artifacts'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  const output = join(temporary, 'symlink-output')
  await expect(exportProject(dir, output, true)).rejects.toMatchObject({ code: 'PROJECT_SOURCE' })
  expect(await exists(output)).toBe(false)
})

it('rejects transitive local file dependencies even when the source installation is approved', async () => {
  const project = join(temporary, 'nested-source')
  const libraryDir = join(temporary, 'nested-library')
  const sampleDir = join(temporary, 'nested-sample')
  await mkdir(project)
  await mkdir(join(project, 'artifacts'))
  await mkdir(libraryDir)
  await writeJson(join(libraryDir, 'package.json'), { name: 'arcadia-local-library', version: '1.0.0' })
  await writeFile(join(libraryDir, 'index.js'), 'module.exports = 1\n')
  const libraryPack = await exec(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', join(project, 'artifacts')],
    {
      cwd: libraryDir,
      env: { ...process.env, npm_config_cache: cache },
      timeout: 30000,
    },
  )
  const library = join(project, 'artifacts', JSON.parse(libraryPack.stdout)[0].filename)
  await cp(join(workspace, 'examples/ugc/slow'), sampleDir, { recursive: true })
  const manifest = await json(join(sampleDir, 'package.json'))
  manifest.dependencies = { 'arcadia-local-library': `file:${library}` }
  await writeJson(join(sampleDir, 'package.json'), manifest)
  const samplePack = await exec(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', join(project, 'artifacts')],
    {
      cwd: sampleDir,
      env: { ...process.env, npm_config_cache: cache },
      timeout: 30000,
    },
  )
  const contentTarball = JSON.parse(samplePack.stdout)[0].filename
  await writeJson(join(project, 'package.json'), {
    name: 'nested-project',
    version: '1.0.0',
    private: true,
    dependencies: { '@arcadia-example/slow': `file:artifacts/${contentTarball}` },
  })
  await npm(project, ['install'])
  await approval(project)
  const output = join(temporary, 'nested-output')
  await expect(exportProject(project, output, true)).rejects.toMatchObject({ code: 'PROJECT_SOURCE' })
  expect(await exists(output)).toBe(false)
}, 60000)

it('preserves an omitted optional peer dependency in the current lockfile format', async () => {
  const project = join(temporary, 'v3-peer-source')
  const sampleDir = join(temporary, 'v3-peer-sample')
  await mkdir(project)
  await mkdir(join(project, 'artifacts'))
  await cp(join(workspace, 'examples/ugc/slow'), sampleDir, { recursive: true })
  const manifest = await json(join(sampleDir, 'package.json'))
  manifest.peerDependencies = { 'arcadia-optional-peer-fixture': '^1.0.0' }
  manifest.peerDependenciesMeta = { 'arcadia-optional-peer-fixture': { optional: true } }
  await writeJson(join(sampleDir, 'package.json'), manifest)
  const packed = await exec(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', join(project, 'artifacts')],
    {
      cwd: sampleDir,
      env: { ...process.env, npm_config_cache: cache },
      timeout: 30000,
    },
  )
  const tarball = JSON.parse(packed.stdout)[0].filename
  await writeJson(join(project, 'package.json'), {
    name: 'v3-peer-project',
    version: '1.0.0',
    private: true,
    dependencies: { '@arcadia-example/slow': `file:artifacts/${tarball}` },
  })
  await npm(project, ['install', '--lockfile-version=3'])
  expect((await json(join(project, 'package-lock.json'))).lockfileVersion).toBe(3)
  const inspected = await inspectNpmProject(project)
  await approval(project)
  const output = join(temporary, 'v3-peer-export')
  const exported = await exportProject(project, output, true)
  const lock = await json(join(output, 'package-lock.json'))
  expect(lock.lockfileVersion).toBe(3)
  expect(lock.packages['node_modules/@arcadia-example/slow'].peerDependenciesMeta).toEqual({
    'arcadia-optional-peer-fixture': { optional: true },
  })
  await npm(output, ['ci', '--omit=dev'])
  expect((await inspectNpmProject(output)).digest).toBe(inspected.digest)
  await approval(output)
  expect(await verifyProject(output)).toMatchObject({ verified: true, revision: exported.revision })
}, 60000)

it.each([
  ['credentials', 'https://user:password@registry.npmjs.org/@arcadia-example/slow/-/slow-1.0.0.tgz'],
  ['query token', 'https://registry.npmjs.org/@arcadia-example/slow/-/slow-1.0.0.tgz?token=PRIVATE_SENSITIVE'],
  ['private registry', 'https://private.example.test/@arcadia-example/slow/-/slow-1.0.0.tgz'],
])('rejects %s in registry sources without disclosing them', async (_scenario, url) => {
  const dir = await copySource(`unsafe-${_scenario.replaceAll(' ', '-')}`)
  const manifest = await json(join(dir, 'package.json')),
    lock = await json(join(dir, 'package-lock.json'))
  manifest.dependencies['@arcadia-example/slow'] = '1.0.0'
  lock.packages[''].dependencies['@arcadia-example/slow'] = '1.0.0'
  lock.packages['node_modules/@arcadia-example/slow'].resolved = url
  await writeJson(join(dir, 'package.json'), manifest)
  await writeJson(join(dir, 'package-lock.json'), lock)
  const output = join(temporary, `unsafe-output-${_scenario.replaceAll(' ', '-')}`)
  const probe = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch
  await expect(exportProject(dir, output, true, probe)).rejects.toMatchObject({ code: 'PROJECT_SOURCE' })
  expect(probe).not.toHaveBeenCalled()
  expect(await exists(output)).toBe(false)
})
