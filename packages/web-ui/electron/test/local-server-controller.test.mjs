import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LocalServerController, launchConfiguration } from '../local-server-controller.mjs'

const configuration = { name: '好友服', content: 'official', scope: 'lan', port: 8102 }
function fixture({ saved = false, prepare, start, stop, wait, selection, startProject } = {}) {
  let state = { status: 'idle' }
  const calls = []
  const lease = { directory: '/owned/official', release: async () => calls.push('release') }
  const host = {
    status: () => state,
    start: async (directory, options) => {
      calls.push(['start', directory, options])
      await start?.()
      state = { status: 'running', url: 'http://127.0.0.1:8102' }
      return state
    },
    stopHosting: async options => {
      calls.push(['stop', options])
      await stop?.(options)
      state = { status: 'idle' }
    },
    startLocalRecovery: async () => {
      calls.push('recover')
      state = { status: 'running', localRecovery: true }
    },
  }
  const library = {
    acquireDefaultProject: async () => {
      calls.push(['acquire-default'])
      await prepare?.()
      return lease
    },
    list: async () => selection ?? { selection: { status: 'ready' } },
    acquireProject: async () => ({ ...lease, directory: '/owned/local-play' }),
  }
  const controller = new LocalServerController({
    host,
    startProject,
    library: () => library,
    profile: async () => (saved ? { projectDirectory: '/owned/saved' } : {}),
    wait: wait ?? (async () => {}),
  })
  return { controller, calls, host }
}
test('first launch prepares official content independently and sends settings before starting', async () => {
  const { controller, calls } = fixture()
  const result = await controller.request({ action: 'start', configuration })
  assert.equal(result.host.status, 'running')
  assert.deepEqual(calls, [
    ['acquire-default'],
    [
      'start',
      '/owned/official',
      { launch: { name: '好友服', host: '0.0.0.0', port: 8102, publicOrigin: null, officialContent: true } },
    ],
    'release',
  ])
})
test('saved hosting ignores later local-play selections and preserves database settings', async () => {
  const { controller, calls } = fixture({ saved: true })
  await controller.request({ action: 'start' })
  assert.deepEqual(calls, [['start', '/owned/saved', {}]])
  await controller.request({ action: 'start' })
  assert.equal(calls.length, 1)
})
test('simultaneous launch requests share preparation; status polling is read only', async () => {
  let release
  const blocked = new Promise(resolve => {
    release = resolve
  })
  const { controller, calls } = fixture({ prepare: () => blocked })
  const first = controller.request({ action: 'start', configuration })
  const second = controller.request({ action: 'start', configuration })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await controller.request({ action: 'status' })).phase, 'preparing')
  release()
  await Promise.all([first, second])
  assert.equal(calls.filter(call => call[0] === 'start').length, 1)
})
test('failed preparation releases no unacquired lease and leaves the server stopped', async () => {
  const { controller, calls } = fixture({
    prepare: () => {
      throw new Error('缺少离线依赖')
    },
  })
  const result = await controller.request({ action: 'start', configuration })
  assert.equal(result.phase, 'failed')
  assert.equal(result.error.message, '缺少离线依赖')
  assert.equal(result.host.status, 'idle')
  assert.equal(calls.length, 1)
})
test('stopping drains active games and eventually stops without a second user click', async () => {
  let active = 2
  const { controller, calls } = fixture({
    saved: true,
    stop: () => {
      if (active-- > 0) throw Object.assign(new Error('对局中'), { code: 'HOST_DRAINING' })
    },
  })
  await controller.request({ action: 'start' })
  const result = await controller.request({ action: 'stop' })
  assert.equal(result.host.status, 'idle')
  assert.deepEqual(
    calls.filter(call => call[0] === 'stop'),
    Array(3).fill(['stop', { force: false }]),
  )
})
test('force stop during a pending restart cancels the restart', async () => {
  let release,
    draining = true
  const waiting = new Promise(resolve => {
    release = resolve
  })
  const { controller, calls } = fixture({
    saved: true,
    wait: () => waiting,
    stop: ({ force }) => {
      if (force) {
        draining = false
        release()
      }
      if (draining) throw Object.assign(new Error('对局中'), { code: 'HOST_DRAINING' })
    },
  })
  await controller.request({ action: 'start' })
  const restarting = controller.request({ action: 'restart' })
  await new Promise(resolve => setImmediate(resolve))
  await controller.request({ action: 'stop', force: true })
  await restarting
  assert.equal(calls.filter(call => call[0] === 'start').length, 1)
})
test('shutdown during content preparation prevents a late server process', async () => {
  let release
  const waiting = new Promise(resolve => {
    release = resolve
  })
  const { controller, calls } = fixture({ prepare: () => waiting })
  const starting = controller.request({ action: 'start', configuration })
  await new Promise(resolve => setImmediate(resolve))
  controller.close()
  release()
  await starting
  assert.equal(calls.filter(call => call[0] === 'start').length, 0)
  assert.ok(calls.includes('release'))
})
test('rejects directory/command injection and malformed network settings', async () => {
  for (const extra of [
    { directory: '/tmp/project' },
    { port: -1 },
    { port: '8102' },
    { name: ' ' },
    { scope: 'public', publicOrigin: 'https://user:secret@example.com' },
    { scope: 'public', publicOrigin: 'https://example.com/admin' },
  ])
    assert.throws(() => launchConfiguration({ ...configuration, ...extra }))
  const { controller } = fixture()
  await assert.rejects(controller.request({ action: 'stop', force: 'yes' }))
  await assert.rejects(controller.request({ action: 'restart', configuration }))
})

test('unprepared current content never silently falls back to official content', async () => {
  const { controller, calls } = fixture({
    selection: { selection: { status: 'idle' }, desiredIds: ['unfinished'], hasSelection: false },
  })
  const result = await controller.request({ action: 'start', configuration: { ...configuration, content: 'current' } })
  assert.equal(result.error.code, 'CONTENT_NOT_READY')
  assert.deepEqual(calls, [])
})
test('registered-project hosting shares the same lifecycle lock', async () => {
  let release
  const waiting = new Promise(resolve => {
    release = resolve
  })
  const projects = []
  const { controller } = fixture({
    startProject: async id => {
      projects.push(id)
      await waiting
    },
  })
  const pending = controller.request({ action: 'start-project', projectId: 'registered-project' })
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(controller.request({ action: 'start', configuration }), { code: 'HOST_BUSY' })
  await assert.rejects(controller.request({ action: 'start-project', projectId: 'other-project' }), {
    code: 'HOST_BUSY',
  })
  release()
  assert.equal((await pending).phase, 'ready')
  assert.deepEqual(projects, ['registered-project'])
})
