import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LocalServerController, launchConfiguration } from '../local-server-controller.ts'

const configuration = { name: '好友服', scope: 'lan', port: 8102 }
function fixture({ saved = false, prepare, start, stop, wait } = {}) {
  let state = { status: 'idle' }
  const calls = []
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
  }
  const controller = new LocalServerController({
    host,
    defaultProject: async () => {
      calls.push(['default-project'])
      await prepare?.()
      return '/owned/environments/builtin-server'
    },
    profile: async () => (saved ? { projectDirectory: '/owned/saved' } : {}),
    wait: wait ?? (async () => {}),
  })
  return { controller, calls, host }
}
test('first launch publishes the client library and keeps the official server default', async () => {
  const { controller, calls } = fixture()
  const result = await controller.request({ action: 'start', configuration })
  assert.equal(result.host.status, 'running')
  assert.deepEqual(calls, [
    ['default-project'],
    [
      'start',
      '/owned/environments/builtin-server',
      {
        publishClientEnvironments: true,
        launch: { name: '好友服', host: '0.0.0.0', port: 8102, publicOrigin: null },
      },
    ],
  ])
})
test('saved hosting uses the current client environment and preserves database settings', async () => {
  const { controller, calls } = fixture({ saved: true })
  await controller.request({ action: 'start', configuration })
  assert.deepEqual(calls, [
    ['default-project'],
    ['start', '/owned/environments/builtin-server', { publishClientEnvironments: true }],
  ])
  await controller.request({ action: 'start' })
  assert.equal(calls.length, 2)
})
test('loopback recovery publishes the same ready client environments', async () => {
  const { controller, calls } = fixture({ saved: true })
  const result = await controller.request({ action: 'recover' })
  assert.equal(result.host.status, 'running')
  assert.deepEqual(calls, [
    ['default-project'],
    ['start', '/owned/environments/builtin-server', { publishClientEnvironments: true, localRecovery: true }],
  ])
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
test('failed default environment lookup leaves the server stopped', async () => {
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

test('the desktop lifecycle rejects starting from a project', async () => {
  const { controller, calls } = fixture()
  await assert.rejects(controller.request({ action: 'start-project', projectId: 'registered-project' }), {
    code: 'INVALID_REQUEST',
  })
  assert.deepEqual(calls, [])
})
test('the authenticated player route delegates status, first launch, graceful restart and explicit force stop to the existing controller', async () => {
  const { playerLibraryRequest } = await import('../player-library-bridge.ts')
  const { controller, calls } = fixture()
  const dispatch = playerLibraryRequest({ serverController: controller })
  const server = (action, options = {}) => dispatch({ operation: 'server', action, ...options })
  assert.equal((await server('status')).host.status, 'idle')
  assert.deepEqual(calls, [])
  await assert.rejects(server('start'), { code: 'LAUNCH_REQUIRED' })
  assert.equal((await server('status')).error.code, 'LAUNCH_REQUIRED')
  for (const input of [
    { action: 'recover' },
    { action: 'start-project', projectId: 'any' },
    { action: 'start', configuration: { ...configuration, directory: '/tmp/replacement' } },
    { action: 'restart', force: true },
  ]) {
    await assert.rejects(dispatch({ operation: 'server', ...input }))
  }
  assert.deepEqual(calls, [])
  const local = { ...configuration, scope: 'local', port: 0 }
  assert.equal((await server('start', { configuration: local })).host.status, 'running')
  assert.deepEqual(calls[1][2].launch, {
    name: local.name,
    host: '127.0.0.1',
    port: 0,
    publicOrigin: null,
  })
  await assert.rejects(server('start', { configuration }), { code: 'SERVER_ALREADY_CONFIGURED' })
  assert.equal((await server('status')).phase, 'ready')
  // The production host saves the initial project after the listener is ready.
  controller.profile = async () => ({ projectDirectory: '/owned/saved' })
  assert.equal((await server('restart')).host.status, 'running')
  assert.ok(calls.some(entry => entry[0] === 'stop' && entry[1].force === false))
  assert.deepEqual(calls.filter(entry => entry[0] === 'start').at(-1), [
    'start',
    '/owned/environments/builtin-server',
    { publishClientEnvironments: true },
  ])
  assert.equal((await server('stop', { force: true })).host.status, 'idle')
  assert.deepEqual(calls.at(-1), ['stop', { force: true }])
  await assert.rejects(server('start', { configuration: local }), { code: 'SERVER_ALREADY_CONFIGURED' })
})

test('an explicit CLI first-launch configuration cannot coalesce into a pending start with different settings', async () => {
  const { playerLibraryRequest } = await import('../player-library-bridge.ts')
  let finishPreparation
  const wait = new Promise(resolve => {
    finishPreparation = resolve
  })
  const { controller, calls } = fixture({ prepare: () => wait })
  const dispatch = playerLibraryRequest({ serverController: controller })
  const configuring = dispatch({ operation: 'server', action: 'start', configuration })
  await assert.rejects(
    dispatch({ operation: 'server', action: 'start', configuration: { ...configuration, scope: 'local' } }),
    { code: 'HOST_BUSY' },
  )
  finishPreparation()
  assert.equal((await configuring).host.status, 'running')
  assert.equal(calls.filter(entry => entry[0] === 'start').length, 1)
})
