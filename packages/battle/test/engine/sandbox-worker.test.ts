import * as authoringSdk from '@arcadia-eternity/battle/authoring'
import { Worker } from 'node:worker_threads'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import nodeEndpoint from 'comlink/dist/esm/node-adapter.mjs'
import { parse } from 'yaml'
import { BattleWorkerManager } from '../../sandbox'
import officialEffectArtifact from '@arcadia-eternity/data-pack-base/effects?effect-module'
import { officialTemplateDefinitions, createCatalog, createEffects } from '@arcadia-eternity/data-pack-base/effects'
import input from '../fixtures/official-switch.input.json'
import { BattleMessageType, BattleStatus, createContentCatalog } from '../../engine'
import { LocalBattleSystem, type BattleHost } from '../../host'
import type { SandboxBattleInput } from '../../src/sandbox/runtime'

const managers: BattleWorkerManager[] = []
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.dispose()
})
function manager(
  overrides: Partial<ConstructorParameters<typeof BattleWorkerManager>[1]> = {},
  workerUrl = new URL('../../dist/sandbox-node-worker.js', import.meta.url),
) {
  const result = new BattleWorkerManager(
    () => {
      const worker = new Worker(workerUrl)
      return {
        endpoint: nodeEndpoint(worker),
        terminate: () => worker.terminate(),
        onFailure(handler) {
          const error = (value: Error) => handler(value.message),
            exit = (code: number) => handler(`exit ${code}`)
          worker.on('error', error)
          worker.on('exit', exit)
          return () => {
            worker.off('error', error)
            worker.off('exit', exit)
          }
        },
      }
    },
    { maxBattles: 4, initializeMs: 20_000, requestMs: 5_000, cleanupMs: 1_000, heartbeatMs: 1000, ...overrides },
  )
  managers.push(result)
  return result
}
function fixture(): SandboxBattleInput {
  expect(officialEffectArtifact).toMatchObject({
    format: 'arcadia.effect-module',
    packageId: '@arcadia-eternity/data-pack-base',
  })
  const root = new URL('../../../../packs/base/', import.meta.url)
  const manifest = JSON.parse(readFileSync(new URL('pack.json', root), 'utf8'))
  const read = (kind: string) =>
    manifest.data[kind].flatMap((file: string) =>
      parse(readFileSync(new URL(`data/${file}`, root), 'utf8'), { merge: true }),
    )
  return {
    environment: {
      revision: 'sandbox/official-test',
      data: {
        marks: read('marks'),
        skills: read('skills'),
        species: read('species'),
        behaviors: officialTemplateDefinitions,
      },
      modules: [{ artifact: officialEffectArtifact, role: 'catalog', namespace: '' }],
    },
    players: structuredClone(input.teams),
    options: { rngSeed: input.seed, showHidden: true, allowFaintSwitch: true, timerConfig: { enabled: false } },
  }
}
async function drive(battle: BattleHost) {
  const cursors = [0, 0],
    trace = []
  const scripts = [input.actions.A, input.actions.B]
  for (let round = 0; round < 30; round++) {
    const pending = await battle.waitForPendingDecision(),
      state = await battle.getState(undefined, true)
    trace.push({
      turn: state.currentTurn,
      phase: state.currentPhase,
      status: state.status,
      players: state.players.map(player => ({
        rage: player.rage,
        team: player.team?.map(pet => ({ hp: pet.currentHp, marks: pet.marks.map(mark => [mark.baseId, mark.stack]) })),
      })),
    })
    if (state.status === BattleStatus.Ended) return trace
    for (const [seat, choices] of pending.selections.entries()) {
      if (!choices.length) continue
      const next = scripts[seat][cursors[seat]],
        player = state.players[seat],
        pet = player.team!.find(pet => pet.id === player.activePet)!
      const scripted =
        next?.type === 'use-skill'
          ? choices.find(
              action =>
                action.type === 'use-skill' &&
                (pet.skills ?? []).some(skill => skill.id === action.skill && skill.baseId === next.skill),
            )
          : choices.find(
              action =>
                action.type === 'switch-pet' &&
                player.team!.some(pet => pet.id === action.pet && pet.name === next?.pet),
            )
      const action =
        scripted ??
        choices.find(action => action.type === 'use-skill') ??
        choices.find(action => action.type !== 'surrender')
      if (!action) throw Error('No legal battle action')
      if (scripted) cursors[seat]++
      await battle.submitAction(action)
    }
  }
  throw Error('Official battle did not finish')
}
it('runs the complete official catalog inside a dedicated Worker with Arena and forwards native events', async () => {
  const host = manager({ cleanupMs: 5000 }),
    spec = fixture(),
    battle = await host.create(spec)
  expect((await battle.getState(undefined, true)).status).toBe(BattleStatus.Unstarted)
  const events: string[] = []
  battle.BattleEvent(
    message => {
      events.push(message.type)
    },
    { showHidden: true },
  )
  await battle.ready()
  const pending = await battle.waitForPendingDecision()
  expect(pending.selections[0].length).toBeGreaterThan(0)
  expect(events).toContain(BattleMessageType.TurnAction)
  const actual = await drive(battle)
  const content = createContentCatalog(spec.environment.data, spec.environment.revision, createCatalog, context => ({
    nativeExports: createEffects({ sdk: authoringSdk, marks: context.marks, id: local => local }),
  }))
  const [a, b] = content.parsePlayers(spec.players)
  const reference = new LocalBattleSystem(content.createBattle(a, b, spec.options), content)
  try {
    await reference.ready()
    expect(actual).toEqual(await drive(reference))
  } finally {
    await reference.cleanup()
  }
  expect((await battle.getState(undefined, true)).status).toBe(BattleStatus.Ended)
  await battle.cleanup()
  expect(host.status().at(-1)?.state).toBe('disposed')
  expect(host.status().at(-1)?.cleanup, host.status().at(-1)?.cleanupFault).toBe('graceful')
  await expect(battle.getState()).rejects.toThrow(/disposed/)
}, 30_000)

function small(source = 'export function createEffects(){return []}'): SandboxBattleInput {
  const skill = { id: 'strike', element: 'Normal', category: 'Physical', power: 20, rage: 0, accuracy: 100 }
  return {
    environment: {
      revision: 'small',
      data: {
        marks: [],
        skills: [skill],
        species: [
          {
            id: 'pet',
            num: 1,
            element: 'Normal',
            baseStats: { hp: 200, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
            genderRatio: null,
            heightRange: [1, 2],
            weightRange: [1, 2],
            ability: [],
            emblem: [],
            learnable_skills: [{ skill_id: 'strike', level: 1, hidden: false }],
          },
        ],
      },
      modules: [
        {
          namespace: 'test',
          role: 'behaviors',
          artifact: { format: 'arcadia.effect-module', version: 1, sdkApi: 2, packageId: 'test', source },
        },
      ],
    },
    players: input.teams.map((player, index) => ({
      ...structuredClone(player),
      id: String(index).repeat(21),
      team: [
        {
          ...structuredClone(player.team[0]),
          id: String(index + 2).repeat(21),
          species: 'pet',
          skills: ['strike'],
          ability: undefined,
          emblem: undefined,
        },
      ],
    })),
    options: { rngSeed: 'small', timerConfig: { enabled: false }, showHidden: true },
  }
}
it('terminates a stuck startup and preserves another active battle', async () => {
  // Allow a real cold WASM startup; the stuck module still hits the Worker
  // deadline before its own 10-second VM preparation budget.
  const host = manager({ initializeMs: 5000 }),
    healthy = await host.create(small())
  const before = await healthy.getState(undefined, true)
  await expect(host.create(small('for(;;){}'))).rejects.toThrow(/deadline/)
  expect(await healthy.getState(undefined, true)).toEqual(before)
  expect(host.status().filter(value => value.state === 'faulted')).toHaveLength(1)
  await healthy.ready()
  expect((await healthy.waitForPendingDecision()).selections[0].length).toBeGreaterThan(0)
}, 20_000)
it('reconstructs an official waiting checkpoint in a fresh Worker and continues identically', async () => {
  const host = manager({ cleanupMs: 5000 }),
    spec = fixture(),
    original = await host.create(spec)
  await original.ready()
  await original.waitForPendingDecision()
  const saved = await original.createRuntimeSnapshot(),
    before = await original.getState(undefined, true)
  const restored = await host.create(spec)
  await restored.restoreRuntimeSnapshot(saved)
  await restored.ready()
  expect(await restored.getState(undefined, true)).toEqual(before)
  expect(await drive(restored)).toEqual(await drive(original))
  await restored.cleanup()
  await original.cleanup()
  expect(host.status().every(value => value.cleanup === 'graceful')).toBe(true)
}, 45_000)
it('restores a UGC initial checkpoint in a new Worker without a package-specific opt-in', async () => {
  const host = manager(),
    spec = small(),
    original = await host.create(spec)
  const saved = await original.createRuntimeSnapshot(),
    fingerprint = await original.getInitialFingerprint()
  await original.cleanup()
  const restored = await host.create(spec)
  await restored.restoreRuntimeSnapshot(saved)
  expect(await restored.getInitialFingerprint()).toEqual(fingerprint)
  await restored.ready()
  expect((await restored.waitForPendingDecision()).selections[0].length).toBeGreaterThan(0)
})
it('stops a running battle after a caught SDK permission fault', async () => {
  const host = manager(),
    spec = small(`export function createEffects({sdk,id}){
    return [sdk.defineCodeEffect({id:id('fault'),sourceKind:'skill',triggers:[sdk.EffectTrigger.OnHit],
      apply(ctx){try{ctx.source.owner.currentHp=0}catch{}}
    })]
  }`)
  Object.assign(spec.environment.data, {
    behaviors: [
      {
        formatVersion: 1,
        id: 'test:fault',
        sourceKind: 'skill',
        parameters: {},
        implementation: { kind: 'native', exportId: 'test:fault' },
      },
    ],
    skills: spec.environment.data.skills.map(skill => ({
      ...(skill as object),
      behaviors: [{ useId: 'fault', definitionId: 'test:fault' }],
    })),
  })
  const battle = await host.create(spec)
  const events: string[] = []
  battle.BattleEvent(
    message => {
      events.push(message.type)
    },
    { showHidden: true },
  )
  await expect(
    (async () => {
      await battle.ready()
      const pending = await battle.waitForPendingDecision()
      for (const choices of pending.selections)
        await battle.submitAction(choices.find(action => action.type === 'use-skill')!)
      await battle.waitForPendingDecision()
    })(),
  ).rejects.toThrow(/Use SDK operations/)
  await expect(battle.getState()).rejects.toThrow()
  await battle.cleanup()
  expect(events).not.toContain(BattleMessageType.BattleEnd)
  expect(host.status().at(-1)?.state).toBe('faulted')
}, 10_000)
it('preserves SDK constructors and native healing after production minification', async () => {
  const { rolldown } = await import('rolldown'),
    directory = await mkdtemp(join(tmpdir(), 'arcadia-minified-worker-'))
  const build = await rolldown({
    input: new URL('../../src/sandbox/node-worker.ts', import.meta.url).pathname,
    plugins: [
      {
        name: 'installed-runtime-dependencies',
        resolveId(id) {
          if (id.startsWith('node:')) return { id, external: true }
          if (!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0'))
            return { id: import.meta.resolve(id), external: true }
        },
      },
    ],
  })
  let battle: Awaited<ReturnType<BattleWorkerManager['create']>> | undefined
  try {
    const file = join(directory, 'worker.mjs')
    await build.write({ file, format: 'esm', minify: true })
    const spec = small(`export function createEffects({sdk,id}){
      new sdk.ParameterCatalog([]);
      return [sdk.defineCodeEffect({id:id('heal'),sourceKind:'skill',triggers:[sdk.EffectTrigger.OnHit],apply(ctx){
        const pet=ctx.source.owner;if(!(pet instanceof sdk.Pet))throw Error('domain class identity');
        pet.heal(new sdk.HealContext(ctx,ctx.source,pet,ctx.battle.randomInt(1,1)));
      }})]
    }`)
    Object.assign(spec.environment.data, {
      behaviors: [
        {
          formatVersion: 1,
          id: 'test:heal',
          sourceKind: 'skill',
          parameters: {},
          implementation: { kind: 'native', exportId: 'test:heal' },
        },
      ],
      skills: spec.environment.data.skills.map(skill => ({
        ...(skill as object),
        behaviors: [{ useId: 'heal', definitionId: 'test:heal' }],
      })),
    })
    battle = await manager({}, pathToFileURL(file)).create(spec)
    const events: string[] = []
    battle.BattleEvent(
      message => {
        events.push(message.type)
      },
      { showHidden: true },
    )
    await battle.ready()
    const pending = await battle.waitForPendingDecision()
    for (const choices of pending.selections)
      await battle.submitAction(choices.find(action => action.type === 'use-skill')!)
    await battle.waitForPendingDecision()
    expect(events).toContain(BattleMessageType.Heal)
  } finally {
    await battle?.cleanup()
    await build.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 20_000)
it('releases cancellation and admission slots without reusing a Worker', async () => {
  const host = manager({ maxBattles: 1 }),
    signal = new AbortController(),
    battle = await host.create(small(), signal.signal)
  await expect(host.create(small())).rejects.toThrow(/Concurrent/)
  signal.abort()
  await battle.cleanup()
  const next = await host.create(small())
  expect(next.id).not.toBe(battle.id)
  expect(host.status().filter(value => value.state === 'active')).toHaveLength(1)
}, 10_000)
