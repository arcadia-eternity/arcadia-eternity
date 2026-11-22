import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { writeDesktopCliLauncher } from './desktop-cli-launcher.mjs'

const windows = process.platform === 'win32'

function run(command, args, options, input = '') {
  // cmd /S removes the first and last double quote; only test-owned, quoted argument strings reach it.
  const line = [command, ...args].map(value => '"' + value + '"').join(' ')
  const launched = windows
    ? spawn(process.env.ComSpec, ['/d', '/v:off', '/s', '/c', '"' + line + '"'], {
        ...options,
        windowsVerbatimArguments: true,
      })
    : spawn(command, args, options)
  let output = '',
    errors = ''
  launched.stdout.on('data', data => {
    output += data
  })
  launched.stderr.on('data', data => {
    errors += data
  })
  launched.stdin.end(input)
  return new Promise((resolve, reject) => {
    launched.on('error', reject)
    launched.on('close', code => resolve({ code, output, errors }))
  })
}

async function getPaths(runtime, privateBin, env) {
  const code = `import { join } from 'node:path'
    import { pathToFileURL } from 'node:url'
    const {getDesktopCommandPaths} = await import(pathToFileURL(join(process.argv[1], 'bin/desktop-author-cli.mjs')))
    const paths = await Promise.all([getDesktopCommandPaths(process.argv[2]), getDesktopCommandPaths(process.argv[2])])
    console.log(JSON.stringify(paths[0]))`
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['--input-type=module', '-e', code, '--', runtime, privateBin],
    { env },
  )
  return JSON.parse(stdout)
}

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arcadia cli-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const app = join(root, 'Arcadia App')
  const host = join(app, windows ? 'Arcadia Preview.exe' : "Arcadia's Preview")
  const runtime = join(app, 'resources/arcadia-server')
  const cli = join(runtime, 'node_modules/@arcadia-eternity/content-sdk/bin/arcadia-content.mjs')
  await mkdir(dirname(cli), { recursive: true })
  if (windows) await copyFile(process.execPath, host)
  else await symlink(process.execPath, host)
  await writeFile(
    cli,
    [
      'const text = []; for await (const chunk of process.stdin) text.push(chunk);',
      'console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),input:Buffer.concat(text).toString(),npm:process.env.ARCADIA_NPM_CLI,node:process.env.ELECTRON_RUN_AS_NODE}));',
      "if(process.argv.includes('fail')) process.exitCode=23;",
    ].join('\n'),
  )
  const rootScript = join(runtime, 'cli.js')
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(
    rootScript,
    (await readFile(cli, 'utf8')).replace('args:process.argv.slice(2)', "kind:'root',args:process.argv.slice(2)"),
  )
  const source = await writeDesktopCliLauncher({ runtime, executable: host, platform: process.platform })
  const moved = join(root, 'Installed location')
  await rename(app, moved)
  return {
    root,
    app: moved,
    launcher: join(moved, relative(app, source)),
    runtime: join(moved, relative(app, runtime)),
  }
}

test('relocated desktop command forwards stdin, arguments, cwd and exit status with no Node or npm in PATH', async t => {
  const { root, launcher, runtime } = await fixture(t)
  const args = ['workspace', 'a & b', '--id', '两个队伍', 'fail']
  const result = await run(
    launcher,
    args,
    { cwd: root, env: { ...process.env, PATH: '', ARCADIA_NPM_CLI: 'unrelated' } },
    '{"seed":42}',
  )
  assert.equal(result.code, 23, result.errors)
  assert.deepEqual(JSON.parse(result.output), {
    args,
    cwd: root,
    input: '{"seed":42}',
    npm: join(runtime, 'runtime/npm/bin/npm-cli.js'),
    node: '1',
  })
  const rootResult = await run(
    join(dirname(launcher), windows ? 'arcadia.cmd' : 'arcadia'),
    args,
    { cwd: root, env: { ...process.env, PATH: '' } },
    'game input',
  )
  assert.equal(rootResult.code, 23, rootResult.errors)
  assert.deepEqual(JSON.parse(rootResult.output), {
    kind: 'root',
    args,
    cwd: root,
    input: 'game input',
    npm: join(runtime, 'runtime/npm/bin/npm-cli.js'),
    node: '1',
  })
})

test('direct command paths run from the installation without touching a fresh user directory or PATH', async t => {
  const { root, launcher, runtime } = await fixture(t)
  const home = join(root, 'Fresh home')
  await mkdir(home)
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDIR: '', APPIMAGE: '', PATH: '' }
  const { shell, commandPaths: commands } = await getPaths(runtime, join(home, 'app-data/cli'), env)
  assert.equal(shell, windows ? 'powershell' : 'posix')
  assert.deepEqual(commands, {
    arcadia: join(dirname(launcher), windows ? 'arcadia.cmd' : 'arcadia'),
    'arcadia-content': launcher,
  })
  assert.deepEqual(await readdir(home), [])
  for (const path of Object.values(commands)) assert.equal((await run(path, ['check'], { cwd: root, env })).code, 0)
})

test('explicit registration uses a user bin on PATH, is repeatable, and preserves unrelated commands', async t => {
  const { root, launcher } = await fixture(t)
  const home = join(root, 'User home')
  const pathDirectory = windows ? join(home, 'Roaming/npm') : join(home, 'bin')
  const options = {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(home, 'Roaming'),
      LOCALAPPDATA: join(home, 'Local'),
      PATH: pathDirectory,
    },
  }
  const register = () => run(launcher, ['--install-user-command'], options)
  const first = await register()
  assert.equal(first.code, 0, first.errors)
  const name = windows ? 'arcadia-content.cmd' : 'arcadia-content'
  const commandPath = join(pathDirectory, name)
  const gamePath = join(pathDirectory, windows ? 'arcadia.cmd' : 'arcadia')
  assert.deepEqual(JSON.parse(first.output), {
    pathDirectory,
    commandPath,
    commandPaths: { arcadia: gamePath, 'arcadia-content': commandPath },
    onPath: true,
  })
  const game = await run(gamePath, ['battle', 'verify'], options)
  assert.equal(game.code, 0, game.errors)
  assert.equal(JSON.parse(game.output).kind, 'root')
  const fromRoot = await run(gamePath, ['--install-user-command'], options)
  assert.equal(fromRoot.code, 0, fromRoot.errors)
  assert.deepEqual(JSON.parse(fromRoot.output), JSON.parse(first.output))
  assert.equal((await register()).code, 0)
  const alias = await run(commandPath, ['check'], options)
  assert.equal(alias.code, 0, alias.errors)
  assert.deepEqual(JSON.parse(alias.output).args, ['check'])
  await rm(gamePath)
  await writeFile(commandPath, 'personal command')
  const collision = await register()
  assert.equal(collision.code, 1)
  assert.match(collision.errors, /different terminal command/)
  assert.equal(await readFile(commandPath, 'utf8'), 'personal command')
  await assert.rejects(readFile(gamePath), { code: 'ENOENT' })
  await rm(commandPath)
  await writeFile(gamePath, 'another game')
  assert.equal((await register()).code, 1)
  assert.equal(await readFile(gamePath, 'utf8'), 'another game')
  await assert.rejects(readFile(commandPath), { code: 'ENOENT' })
  if (windows) {
    await rm(gamePath)
    const executable = join(pathDirectory, 'arcadia.exe')
    await writeFile(executable, 'prior Windows command')
    assert.equal((await register()).code, 1)
    assert.equal(await readFile(executable, 'utf8'), 'prior Windows command')
    await assert.rejects(readFile(commandPath), { code: 'ENOENT' })
  }
})

test('AppImage registration reopens the original image and resolves its new mount', { skip: windows }, async t => {
  const { root, app, launcher, runtime } = await fixture(t)
  const image = join(root, 'Arcadia.AppImage')
  const remount = join(root, 'new mount')
  const homeBin = join(root, 'user bin')
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"
  await writeFile(
    image,
    '#!/usr/bin/env bash\nexport APPDIR=' +
      quote(remount) +
      '\nflags=(--no-sandbox)\nfor arg in "$@"; do if [[ $arg == --no-sandbox ]]; then flags=(); fi; done\nexec ' +
      quote(process.execPath) +
      ' "${flags[@]}" "$@"\n',
    { mode: 0o755 },
  )
  const home = join(root, 'Fresh home')
  const data = join(home, 'app-data')
  const privateBin = join(data, 'cli')
  await mkdir(home)
  const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: '', APPDIR: app, APPIMAGE: image }
  await assert.rejects(getPaths(runtime, join(app, 'transient'), env))
  await assert.rejects(getPaths(runtime, join(home, '.local/bin'), env))
  assert.deepEqual(await readdir(home), [])
  const privatePaths = await getPaths(runtime, privateBin, env)
  assert.deepEqual(privatePaths, {
    shell: 'posix',
    commandPaths: { arcadia: join(privateBin, 'arcadia'), 'arcadia-content': join(privateBin, 'arcadia-content') },
  })
  assert.deepEqual(await readdir(home), ['app-data'])
  assert.deepEqual((await readdir(privateBin)).sort(), ['arcadia', 'arcadia-content'])
  const install = await run(launcher, ['--install-user-command', homeBin], { cwd: root, env })
  assert.equal(install.code, 0, install.errors)
  const { commandPath, commandPaths } = JSON.parse(install.output)
  assert.ok(!(await readFile(commandPath, 'utf8')).includes(app))
  await rename(app, remount)
  for (const path of Object.values(privatePaths.commandPaths)) {
    const direct = await run(path, ['check'], { cwd: root, env: { ...process.env, PATH: '' } })
    assert.equal(direct.code, 0, direct.errors)
    assert.deepEqual(JSON.parse(direct.output).args, ['check'])
  }
  const game = await run(commandPaths.arcadia, ['simulate', 'second launch'], {
    cwd: root,
    env: { ...process.env, PATH: '' },
  })
  assert.equal(game.code, 0, game.errors)
  assert.equal(JSON.parse(game.output).kind, 'root')
  assert.deepEqual(JSON.parse(game.output).args, ['simulate', 'second launch'])
  const cli = await run(commandPath, ['environment', 'second launch'], {
    cwd: root,
    env: { ...process.env, PATH: '' },
  })
  assert.equal(cli.code, 0, cli.errors)
  assert.deepEqual(JSON.parse(cli.output).args, ['environment', 'second launch'])
  assert.equal(JSON.parse(cli.output).npm, join(remount, relative(app, runtime), 'runtime/npm/bin/npm-cli.js'))
})
