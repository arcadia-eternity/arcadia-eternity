import { afterEach, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { npmInvocation, resolveNpmInvocation } from '../src/npm/runner'
import { inspectNpmProject } from '../src/npm/inspect'

const exec = promisify(execFile)
const originalCli = process.env.ARCADIA_NPM_CLI
const originalPath = process.env.PATH
const roots: string[] = []
afterEach(async () => {
  if (originalCli === undefined) delete process.env.ARCADIA_NPM_CLI
  else process.env.ARCADIA_NPM_CLI = originalCli
  if (originalPath === undefined) delete process.env.PATH
  else process.env.PATH = originalPath
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('preserves ordinary npm and forms absolute direct invocations for both platform path formats', () => {
  delete process.env.ARCADIA_NPM_CLI
  expect(npmInvocation(['ls', '--json'])).toEqual({ file: 'npm', args: ['ls', '--json'] })
  expect(npmInvocation(['ls'], { platform: 'win32', executable: 'C:\\Program Files\\nodejs\\node.exe' })).toEqual({
    file: 'C:\\Program Files\\nodejs\\node.exe',
    args: ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js', 'ls'],
  })
  expect(
    npmInvocation(['ci', '--offline'], {
      platform: 'win32',
      cli: 'C:\\arcadia test\\npm-cli.js',
      executable: 'C:\\Electron.exe',
    }),
  ).toEqual({
    file: 'C:\\Electron.exe',
    args: ['C:\\arcadia test\\npm-cli.js', 'ci', '--offline'],
  })
  expect(npmInvocation(['ls'], { platform: 'darwin', cli: '/app/npm-cli.js', executable: '/app/Electron' })).toEqual({
    file: '/app/Electron',
    args: ['/app/npm-cli.js', 'ls'],
  })
  for (const cli of ['', 'npm-cli.js', './npm-cli.js', '/app/npm-cli.js\0'])
    expect(() => npmInvocation(['ls'], { cli })).toThrow('absolute file path')
})

it('executes only the selected Node runtime and preserves arguments literally without PATH or shell', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-npm runner-'))
  roots.push(root)
  const cli = join(root, 'npm cli.cjs')
  await writeFile(cli, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
  process.env.ARCADIA_NPM_CLI = cli
  process.env.PATH = ''
  const args = ['ci', '--offline', 'literal $(touch forbidden)', 'space;echo injected']
  const invocation = await resolveNpmInvocation(args)
  const result = await exec(invocation.file, invocation.args, { cwd: root, env: process.env })
  expect(JSON.parse(result.stdout)).toEqual(args)
  await expect(readFile(join(root, 'forbidden'))).rejects.toMatchObject({ code: 'ENOENT' })
  process.env.ARCADIA_NPM_CLI = join(root, 'missing.cjs')
  await expect(resolveNpmInvocation(['ls'])).rejects.toMatchObject({
    diagnostics: [expect.objectContaining({ code: 'NPM_RUNTIME_INVALID' })],
  })
  process.env.ARCADIA_NPM_CLI = root
  await expect(resolveNpmInvocation(['ls'])).rejects.toThrow('missing or unreadable')
})

it('uses the pinned npm CLI to inspect an installed tree without resolving npm from PATH', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-npm-tree-'))
  roots.push(root)
  await mkdir(join(root, 'node_modules'))
  const manifest = { name: 'server', version: '1.0.0', private: true }
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest))
  await writeFile(
    join(root, 'package-lock.json'),
    JSON.stringify({
      name: manifest.name,
      version: manifest.version,
      lockfileVersion: 3,
      packages: { '': manifest },
    }),
  )
  const cli = join(root, 'record arguments.cjs')
  const log = join(root, 'args.json')
  await writeFile(
    cli,
    `require('node:fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2))); process.stdout.write(JSON.stringify({dependencies:{}}))`,
  )
  process.env.ARCADIA_NPM_CLI = cli
  process.env.PATH = ''
  const result = await inspectNpmProject(root)
  expect(result.packages).toEqual([])
  expect(JSON.parse(await readFile(log, 'utf8'))).toEqual([
    'ls',
    '--all',
    '--long',
    '--json',
    '--omit=dev',
    '--ignore-scripts',
  ])
})
