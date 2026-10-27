import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { get } from 'node:http'
import { fileURLToPath } from 'node:url'
import { LocalBattleHost } from '../local-battle-host.mjs'
import { isTrustedDesktopRequest } from '../local-battle-ipc.mjs'
import { stopForQuit } from '../shutdown.mjs'

const cli = fileURLToPath(new URL('./fixtures/fake-server.mjs', import.meta.url))
const parent = fileURLToPath(new URL('./fixtures/fake-parent.mjs', import.meta.url))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let root
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'arcadia-desktop-host-test-'))
})
after(async () => {
  await rm(root, { recursive: true, force: true })
})
async function project(name) {
  const directory = join(root, name)
  await mkdir(join(directory, 'node_modules'), { recursive: true })
  for (const file of ['package.json', 'package-lock.json', 'arcadia-admission.json'])
    await writeFile(join(directory, file), '{}')
  return directory
}
function host(options = {}) {
  return new LocalBattleHost({
    executable: process.execPath,
    cli,
    rendererOrigin: 'http://localhost:5173',
    startupTimeoutMs: 4000,
    shutdownTimeoutMs: 1000,
    ...options,
  })
}
async function closed(url) {
  return new Promise(resolve => {
    const request = get(url, () => resolve(false))
    request.on('error', () => resolve(true))
    request.setTimeout(500, () => request.destroy())
  })
}

describe('local authority host', () => {
  it('requires bundled executable, CLI, npm runtime and an explicitly prepared project', async () => {
    const directory = await project('checks')
    await assert.rejects(host({ executable: '/missing/node' }).start(directory), { code: 'SERVER_RUNTIME_MISSING' })
    await assert.rejects(host({ cli: '/missing/cli.js' }).start(directory), { code: 'SERVER_RUNTIME_MISSING' })
    await assert.rejects(host({ npmCliPath: join(root, 'missing-npm') }).start(directory), {
      code: 'NPM_RUNTIME_MISSING',
    })
    await assert.rejects(host({ npmCliPath: root }).start(directory), { code: 'NPM_RUNTIME_MISSING' })
    await assert.rejects(host({ npmCliPath: 'npm-cli.js' }).start(directory), { code: 'NPM_RUNTIME_MISSING' })
    await assert.rejects(host({ packsDirectory: join(root, 'missing-packs') }).start(directory), {
      code: 'BASE_PACK_MISSING',
    })
    await assert.rejects(host({ packsDirectory: root }).start(directory), { code: 'BASE_PACK_MISSING' })
    const instance = host()
    await assert.rejects(instance.start(root), { code: 'PROJECT_NOT_READY' })
    assert.equal(instance.status().status, 'failed')
  })
  it('passes only the trusted bundled npm CLI and official packs paths to the child', async () => {
    const directory = await project('runtime-paths')
    const npmCliPath = join(root, 'runtime', 'npm', 'bin', 'npm-cli.js')
    const packsDirectory = join(root, 'bundled-packs')
    await mkdir(join(root, 'runtime', 'npm', 'bin'), { recursive: true })
    await mkdir(join(packsDirectory, 'base'), { recursive: true })
    await writeFile(npmCliPath, '// bundled npm entry')
    await writeFile(join(packsDirectory, 'base', 'pack.json'), '{}')
    const oldCli = process.env.ARCADIA_NPM_CLI,
      oldPacks = process.env.ARCADIA_PACKS_DIR
    process.env.ARCADIA_NPM_CLI = '/untrusted/npm.js'
    process.env.ARCADIA_PACKS_DIR = '/untrusted/packs'
    const instance = host({ npmCliPath, packsDirectory })
    try {
      await instance.start(directory)
      assert.deepEqual(JSON.parse(await readFile(join(directory, 'runtime-paths.json'), 'utf8')), {
        npmCliPath,
        packsDirectory,
      })
    } finally {
      await instance.stop()
      if (oldCli === undefined) delete process.env.ARCADIA_NPM_CLI
      else process.env.ARCADIA_NPM_CLI = oldCli
      if (oldPacks === undefined) delete process.env.ARCADIA_PACKS_DIR
      else process.env.ARCADIA_PACKS_DIR = oldPacks
    }
  })
  it('starts only on loopback with a random port, excludes private environment values and stops cleanly', async () => {
    const directory = await project('success')
    const instance = host()
    process.env.DESKTOP_TEST_SECRET = 'not-for-the-child'
    try {
      const starting = instance.start(directory)
      await assert.rejects(instance.start(directory), { code: 'HOST_BUSY' })
      const result = await starting
      assert.match(result.url, /^http:\/\/127\.0\.0\.1:\d+$/)
      assert.equal(result.status, 'running')
      assert.equal(result.projectName, 'success')
      assert.equal(await closed(result.url), false)
      assert.equal((await instance.stop()).status, 'idle')
      assert.equal(await readFile(join(directory, 'clean-exit'), 'utf8'), 'yes')
      assert.equal(await closed(result.url), true)
      assert.equal((await instance.stop()).status, 'idle')
    } finally {
      delete process.env.DESKTOP_TEST_SECRET
      await instance.stop()
    }
  })
  it('reports a failed project without exposing output and permits a later retry', async () => {
    const instance = host()
    try {
      await assert.rejects(instance.start(await project('refuse')), { code: 'SERVER_START_FAILED' })
      assert.equal(instance.status().status, 'failed')
      assert.doesNotMatch(JSON.stringify(instance.status()), /secret data/)
      await assert.rejects(instance.start(await project('unapproved')), { code: 'NPM_NOT_APPROVED' })
      assert.doesNotMatch(JSON.stringify(instance.status()), /private path/)
      assert.equal((await instance.start(await project('retry'))).status, 'running')
    } finally {
      await instance.stop()
    }
  })
  it('reports unexpected child exit and cancels a pending start', async () => {
    const instance = host()
    try {
      await instance.start(await project('crash'))
      for (let i = 0; i < 100 && instance.status().status !== 'failed'; i++) await delay(20)
      assert.equal(instance.status().code, 'SERVER_EXITED')
      const starting = instance.start(await project('slow'))
      const rejected = assert.rejects(starting)
      await delay(100)
      await instance.stop()
      await rejected
      assert.equal(instance.status().status, 'idle')
    } finally {
      await instance.stop()
    }
  })
  it('does not stop or overwrite a newer host when an older start and concurrent stops finish late', async () => {
    const oldProject = await project('slow')
    const newProject = await project('new-generation')
    const instance = host()
    try {
      for (const delayBeforeStop of [0, 100, 100]) {
        const oldStart = instance.start(oldProject)
        const oldRejected = assert.rejects(oldStart)
        if (delayBeforeStop) await delay(delayBeforeStop)
        const stops = [instance.stop(), instance.stop()]
        const results = await Promise.all(stops)
        assert.ok(results.every(result => result.status === 'idle'))
        const newer = instance.start(newProject)
        await oldRejected
        const started = await newer
        await delay(50)
        assert.equal(instance.status().status, 'running')
        assert.equal(instance.status().serverId, started.serverId)
        assert.equal(await closed(started.url), false)
        await instance.stop()
      }
    } finally {
      await instance.stop()
    }
  })
  it('stops the authority if its parent disappears', async () => {
    const directory = await project('orphan')
    const child = spawn(process.execPath, [parent, cli, directory], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '',
      error = ''
    child.stdout.on('data', data => {
      output += data
    })
    child.stderr.on('data', data => {
      error += data
    })
    const code = await new Promise(resolve => child.on('close', resolve))
    assert.equal(code, 0, error)
    const url = output.trim()
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/)
    const cache = await readFile(join(directory, 'cache-marker'), 'utf8')
    let stopped = false
    for (let i = 0; i < 100 && !stopped; i++) {
      stopped = await closed(url)
      if (!stopped) await delay(20)
    }
    assert.equal(stopped, true)
    for (let i = 0; i < 100; i++) {
      try {
        await stat(cache)
        await delay(20)
      } catch {
        break
      }
    }
    await assert.rejects(stat(cache), { code: 'ENOENT' })
  })
})

describe('desktop shutdown', () => {
  it('continues after failed cleanup and force-stops a host that does not terminate', async () => {
    let forced = false
    await stopForQuit(
      [
        async () => {
          throw new Error('cleanup failed')
        },
      ],
      {
        timeoutMs: 100,
        forceStop: () => {
          forced = true
        },
      },
    )
    assert.equal(forced, false)
    let release
    const stalled = new Promise(resolve => {
      release = resolve
    })
    await stopForQuit([() => stalled], {
      timeoutMs: 20,
      forceStop: () => {
        forced = true
      },
    })
    assert.equal(forced, true)
    release()
  })
})

describe('desktop IPC sender', () => {
  it('accepts only the current main frame at the expected local renderer', () => {
    const contents = { mainFrame: { url: 'http://localhost:5173/room' } }
    const event = { sender: contents, senderFrame: contents.mainFrame }
    assert.equal(isTrustedDesktopRequest(event, contents, 'http://localhost:5173/'), true)
    assert.equal(
      isTrustedDesktopRequest(
        { ...event, senderFrame: { url: contents.mainFrame.url } },
        contents,
        'http://localhost:5173/',
      ),
      false,
    )
    contents.mainFrame.url = 'https://attacker.test/'
    assert.equal(isTrustedDesktopRequest(event, contents, 'http://localhost:5173/'), false)
    contents.mainFrame.url = 'file:///app/dist/index.html#/room'
    assert.equal(isTrustedDesktopRequest(event, contents, 'file:///app/dist/index.html'), true)
    contents.mainFrame.url = 'file:///tmp/foreign.html'
    assert.equal(isTrustedDesktopRequest(event, contents, 'file:///app/dist/index.html'), false)
  })
})
