import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PlayerBattleEnvironments } from '../player-battle-environment.mjs'

const acquire = { operation: 'battle-environment-acquire', environmentId: 'friends' }

test('abandoned battle snapshot expires and path or scope overrides are rejected before acquiring', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-expiring-battle-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let calls = 0
  const released = Promise.withResolvers()
  const grants = new PlayerBattleEnvironments(
    {
      async acquireProject(environmentId) {
        calls++
        const directory = await mkdtemp(join(root, 'read-'))
        return {
          environmentId,
          directory,
          draftRevision: 'draft',
          contentRevision: 'content',
          document: { id: environmentId },
          release: async () => {
            await rm(directory, { recursive: true })
            released.resolve()
          },
        }
      },
    },
    { ttlMs: 20 },
  )
  try {
    for (const invalid of [
      { ...acquire, directory: root },
      { ...acquire, environmentId: '../outside' },
      { operation: 'battle-environment-release', leaseId: root },
    ]) {
      await assert.rejects(grants.request(invalid), { code: 'INVALID_REQUEST' })
    }
    assert.equal(calls, 0)
    const lease = await grants.request(acquire)
    const timeout = setTimeout(() => released.reject(new Error('Snapshot did not expire')), 3000)
    try {
      await released.promise
    } finally {
      clearTimeout(timeout)
    }
    await assert.rejects(readdir(lease.directory), { code: 'ENOENT' })
    assert.deepEqual(await grants.request({ operation: 'battle-environment-release', leaseId: lease.leaseId }), {
      released: true,
    })
  } finally {
    await grants.close()
  }
})

test('closing the bridge releases an in-flight snapshot before shutting down its workspace', async () => {
  const opened = Promise.withResolvers()
  let releases = 0
  const grants = new PlayerBattleEnvironments({ acquireProject: () => opened.promise })
  const pending = grants.request(acquire)
  const closing = grants.close()
  opened.resolve({
    release: async () => {
      releases++
    },
  })
  await assert.rejects(pending, { code: 'PLAYER_LIBRARY_CLOSED' })
  await closing
  await assert.rejects(grants.request(acquire), { code: 'PLAYER_LIBRARY_CLOSED' })
  assert.equal(releases, 1)
})
