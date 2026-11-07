import { expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createLocalContentSessions } from '../local-content-sessions.mjs'
import { createNpmFixture } from '../../../server/test/fixtures/npm'
import { emptyNpmContentHost, prepareNpmProject } from '@arcadia-eternity/pack-loader/node'
import { buildDisplayCatalog, buildDisplayLocales } from '@arcadia-eternity/pack-loader/native'
import { createNodeBattleWorkerManager } from '@arcadia-eternity/battle/v4/sandbox/node'

it('captures real npm display and resources, preserves prepared recipes across edits, and evaluates effects only in Workers', async () => {
  const fixture = await createNpmFixture({ presentation: true, includeCatalog: true })
  const workers = createNodeBattleWorkerManager()
  let releases = 0
  const sessions = createLocalContentSessions({
    library: {
      acquireProject: async () => ({
        directory: fixture.directory,
        release: async () => {
          releases++
        },
      }),
    },
    load: async () => ({
      host: emptyNpmContentHost,
      prepareNpmProject,
      buildDisplayCatalog,
      buildDisplayLocales,
    }),
    assetUrl: (token: string, hash: string) => `http://localhost/local-content/${token}/${hash}`,
  })
  try {
    await sessions.prepareProject({ directory: fixture.directory })
    const first = await sessions.prepare()
    expect(first.content.locales.bundles.en.species['example-slow:pet'].name).toBe('Display pet')
    expect(first.content.locales.bundles['zh-CN'].species.pet_dilan.name).toBe('迪兰')
    const icon = first.content.species.find((row: { id: string }) => row.id === 'example-slow:pet').presentation.icon
    const hash = icon.split('/').at(-1)
    expect(await readFile(sessions.assetFile(first.token, hash).file)).toEqual(fixture.asset)
    expect(sessions.assetFile('wrong-token', hash)).toBeUndefined()
    const shared = await sessions.capturePersonalEnvironment()
    expect(shared.environment).toEqual(first.environment)
    expect(shared.runtime.contentRevision).toBe(shared.environment.revision.split('/effects:')[0])
    expect(shared.packages.some((pkg: { namespace: string }) => pkg.namespace === 'example-slow')).toBe(true)
    expect(shared.content.species.find((row: { id: string }) => row.id === 'example-slow:pet').presentation.icon).toBe(
      `arcadia-resource:${hash}`,
    )
    expect(Buffer.from(shared.assets.find((asset: { id: string }) => asset.id === hash).data, 'base64')).toEqual(
      fixture.asset,
    )
    expect(JSON.stringify(shared)).not.toContain(fixture.directory)
    expect(JSON.stringify(shared)).not.toContain('/local-content/')
    await fixture.changePower(999)
    const second = await sessions.prepare()
    expect(second.environment).toEqual(first.environment)
    expect(second.token).not.toBe(first.token)
    expect(second.content.skills.find((row: { id: string }) => row.id === 'example-slow:strike').power).not.toBe(999)
    const battle = await workers.create({
      environment: first.environment,
      players: [0, 1].map(side => ({
        id: String(side).repeat(21),
        name: `Player ${side}`,
        team: [
          {
            id: String(side + 2).repeat(21),
            name: 'Pet',
            species: 'example-slow:pet',
            level: 100,
            nature: 'Hardy',
            skills: ['example-slow:strike'],
            evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
            ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
          },
        ],
      })),
      options: { timerConfig: { enabled: false } },
    })
    await battle.ready()
    expect((await battle.getState(undefined, true)).players).toHaveLength(2)
    const initial = await battle.getState(undefined, true)
    const pending = await battle.waitForPendingDecision()
    for (const choices of pending.selections)
      await battle.submitAction(choices.find((action: { type: string }) => action.type === 'use-skill')!)
    await battle.waitForPendingDecision()
    const after = await battle.getState(undefined, true)
    expect(after.players[0].team![0].stats!.spe).toBeLessThan(initial.players[0].team![0].stats!.spe)
    await battle.cleanup()
    const capturedFile = sessions.assetFile(first.token, hash).file
    await sessions.prepareProject({ directory: fixture.directory })
    const updated = await sessions.prepare()
    expect(updated.content.skills.find((row: { id: string }) => row.id === 'example-slow:strike').power).toBe(999)
    await sessions.release(updated.token)
    await sessions.release(first.token)
    expect(sessions.assetFile(first.token, hash)).toBeUndefined()
    expect(sessions.assetFile(second.token, hash)).toBeDefined()
    await sessions.release(second.token)
    expect(releases).toBe(4)
    await expect(readFile(capturedFile)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await sessions.close()
    await workers.dispose()
    await fixture.dispose()
  }
}, 60_000)

it('shares concurrent captures, refreshes without leaks, retries failures and closes pending work', async () => {
  const gates: { resolve: () => void; promise: Promise<void> }[] = []
  const captured: { dispose: ReturnType<(typeof import('vitest'))['vi']['fn']> }[] = []
  let calls = 0,
    releases = 0,
    fail = false
  const empty = { species: [], skills: [], marks: [] }
  const runtime = {
    host: {},
    buildDisplayCatalog,
    buildDisplayLocales,
    prepareNpmProject: async () => {
      calls++
      let resolve!: () => void
      const promise = new Promise<void>(done => {
        resolve = done
      })
      gates.push({ resolve, promise })
      await promise
      if (fail) {
        fail = false
        throw new Error('compile failed')
      }
      const { vi } = await import('vitest')
      const value = {
        data: empty,
        sandbox: {},
        presentation: [],
        releases: [],
        installation: { members: [] },
        build: { coreBuildId: 'core', registryBuildId: 'registry' },
        revision: 'fixture',
        dispose: vi.fn(async () => {}),
      }
      captured.push(value)
      return value
    },
  }
  const sessions = createLocalContentSessions({
    library: {
      acquireProject: async () => ({
        directory: '/fixed',
        release: async () => {
          releases++
        },
      }),
    },
    load: async () => runtime,
    assetUrl: () => '',
  })
  const tick = async () => {
    await new Promise(done => setTimeout(done, 0))
  }
  const first = sessions.prepare(),
    second = sessions.prepare(),
    hook = sessions.prepareProject({ directory: '/fixed' })
  await tick()
  expect(calls).toBe(1)
  gates[0].resolve()
  const [one, two] = await Promise.all([first, second, hook])
  expect(one.token).not.toBe(two.token)
  const refresh = sessions.prepareProject({ directory: '/fixed' })
  await tick()
  gates[1].resolve()
  await refresh
  expect(captured[0].dispose).not.toHaveBeenCalled()
  await sessions.release(one.token)
  await sessions.release(two.token)
  expect(captured[0].dispose).toHaveBeenCalledTimes(1)
  fail = true
  const failed = sessions.prepareProject({ directory: '/fixed' })
  const rejected = expect(failed).rejects.toThrow('compile failed')
  await tick()
  gates[2].resolve()
  await rejected
  const pending = sessions.prepareProject({ directory: '/fixed' })
  const rejectedClose = expect(pending).rejects.toThrow('LOCAL_CONTENT_CLOSED')
  await tick()
  expect(calls).toBe(4)
  const closed = sessions.close()
  gates[3].resolve()
  await Promise.all([closed, rejectedClose])
  expect(captured).toHaveLength(3)
  for (const item of captured) expect(item.dispose).toHaveBeenCalledTimes(1)
  expect(releases).toBe(2)
  await expect(sessions.prepare()).rejects.toThrow('LOCAL_CONTENT_CLOSED')
  await sessions.close()
})

it('releases document owners and rejects late preparation after document retirement', async () => {
  let resume!: () => void
  let releases = 0
  const gate = new Promise<void>(done => {
    resume = done
  })
  const empty = { species: [], skills: [], marks: [] }
  const runtime = {
    host: {},
    buildDisplayCatalog,
    buildDisplayLocales,
    prepareNpmProject: async () => {
      await gate
      return {
        data: empty,
        sandbox: {},
        presentation: [],
        releases: [],
        installation: { members: [] },
        build: { coreBuildId: 'core', registryBuildId: 'registry' },
        revision: 'fixture',
        dispose: async () => {},
      }
    },
  }
  const sessions = createLocalContentSessions({
    library: {
      acquireProject: async () => ({
        directory: '/owner',
        release: async () => {
          releases++
        },
      }),
    },
    load: async () => runtime,
    assetUrl: () => '',
  })
  const late = sessions.prepare('old-document')
  const rejected = expect(late).rejects.toThrow('LOCAL_CONTENT_OWNER_RELEASED')
  await sessions.releaseOwner('old-document')
  resume()
  await rejected
  expect(releases).toBe(1)
  const current = await sessions.prepare('new-document')
  await sessions.releaseOwner('new-document')
  await sessions.release(current.token)
  expect(releases).toBe(2)
  await expect(sessions.prepare('old-document')).rejects.toThrow('LOCAL_CONTENT_OWNER_RELEASED')
  await sessions.close()
})
