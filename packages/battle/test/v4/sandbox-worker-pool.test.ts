import { Worker } from 'node:worker_threads'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import nodeEndpoint from 'comlink/dist/esm/node-adapter.mjs'
import { afterEach, expect, it } from 'vitest'
import { BattleWorkerManager, type BattleWorkerPolicy } from '../../v4-sandbox'
import type { SandboxBattleInput } from '../../src/v4-sandbox/runtime'
import fixture from '../fixtures/official-switch.input.json'

const managers: BattleWorkerManager[] = []
afterEach(async () => {
  await Promise.all(managers.splice(0).map(manager => manager.dispose()))
})
function manager(
  policy: Partial<BattleWorkerPolicy> = {},
  workerUrl = new URL('../../dist/v4-sandbox-node-worker.js', import.meta.url),
  terminate: (worker: Worker) => Promise<unknown> = worker => worker.terminate(),
) {
  const workers: Worker[] = []
  const host = new BattleWorkerManager(
    () => {
      const worker = new Worker(workerUrl)
      workers.push(worker)
      return {
        endpoint: nodeEndpoint(worker),
        terminate: () => terminate(worker),
        onFailure(handler: (message: string) => void) {
          const error = (value: Error) => handler(value.message)
          const exit = (code: number) => handler(`exit ${code}`)
          worker.on('error', error)
          worker.on('exit', exit)
          return () => {
            worker.off('error', error)
            worker.off('exit', exit)
          }
        },
      }
    },
    { maxBattles: 1, cleanupMs: 5000, reuseWorkers: true, vmGrouping: 'environment', ...policy },
  )
  managers.push(host)
  return { host, workers }
}
function input(source = 'export function createEffects(){return []}'): SandboxBattleInput {
  return {
    environment: {
      revision: 'pool-fixture',
      data: {
        marks: [],
        skills: [{ id: 'strike', element: 'Normal', category: 'Physical', power: 20, rage: 0, accuracy: 100 }],
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
    players: fixture.teams.map((player, index) => ({
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
    options: { rngSeed: 'pool', timerConfig: { enabled: false }, showHidden: true },
  }
}

it('reuses prepared content for a new session while expiring all old battle handles', async () => {
  const { host, workers } = manager()
  const first = await host.create(input())
  const initial = await first.getInitialFingerprint()
  const events: unknown[] = []
  const unsubscribe = first.BattleEvent(event => events.push(event))
  await first.ready()
  await first.waitForPendingDecision()
  const waiting = first.waitForCompletion().catch(error => error)
  await first.cleanup()
  await waiting
  const eventsAtCleanup = events.length
  const second = await host.create(input())
  expect(workers).toHaveLength(1)
  expect(await second.getInitialFingerprint()).toEqual(initial)
  expect(host.status().map(status => status.workerId)).toEqual([1, 1])
  await expect(first.ready()).rejects.toThrow(/disposed/)
  await first.cleanup()
  unsubscribe()
  await second.ready()
  expect((await second.waitForPendingDecision()).selections[0].length).toBeGreaterThan(0)
  expect(events).toHaveLength(eventsAtCleanup)
  await second.cleanup()
  await host.dispose()
  expect(workers[0].threadId).toBe(-1)
}, 20_000)

it('checks captured environment contents even when callers reuse a revision string', async () => {
  const { host, workers } = manager()
  const first = await host.create(input())
  await first.cleanup()
  const changed = input('export function createEffects(){ return [] }; const different = true')
  const second = await host.create(changed)
  expect(workers).toHaveLength(2)
  expect(workers[0].threadId).toBe(-1)
  await second.cleanup()
  const third = await host.create(changed)
  expect(workers).toHaveLength(2)
  await third.cleanup()
})

it('enforces active capacity, disposes active and idle workers, and keeps dedicated mode available', async () => {
  const { host, workers } = manager({ maxBattles: 2 })
  const first = await host.create(input())
  const second = await host.create(input())
  await expect(host.create(input())).rejects.toThrow(/Concurrent/)
  await first.cleanup()
  await host.dispose()
  expect(workers.every(worker => worker.threadId === -1)).toBe(true)
  await expect(second.getState()).rejects.toThrow(/disposed/)
  await expect(host.create(input())).rejects.toThrow(/disposed/)
  const dedicated = manager({ reuseWorkers: false })
  await (await dedicated.host.create(input())).cleanup()
  await (await dedicated.host.create(input())).cleanup()
  expect(dedicated.workers).toHaveLength(2)
})

it('discards cancelled leases instead of returning them to the pool', async () => {
  const { host, workers } = manager()
  const cancellation = new AbortController()
  const first = await host.create(input(), cancellation.signal)
  await first.ready()
  const pending = first.waitForCompletion().catch(error => error)
  cancellation.abort()
  await first.cleanup()
  expect(await pending).toBeInstanceOf(Error)
  expect(workers[0].threadId).toBe(-1)
  await (await host.create(input())).cleanup()
  expect(workers).toHaveLength(2)
})

it('discards failed initialization and admits a fresh healthy worker', async () => {
  const { host, workers } = manager()
  await expect(host.create(input('throw Error("broken initialization")'))).rejects.toThrow(/broken initialization/)
  expect(workers[0].threadId).toBe(-1)
  await (await host.create(input())).cleanup()
  expect(workers).toHaveLength(2)
})

it('discards a faulted runtime without carrying its fault into the next session', async () => {
  const { host, workers } = manager()
  const spec = input(`export function createEffects({sdk,id}){
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
  const first = await host.create(spec)
  await expect(
    (async () => {
      await first.ready()
      const pending = await first.waitForPendingDecision()
      for (const choices of pending.selections)
        await first.submitAction(choices.find(action => action.type === 'use-skill')!)
      await first.waitForPendingDecision()
    })(),
  ).rejects.toThrow(/Use SDK operations/)
  await first.cleanup()
  expect(workers[0].threadId).toBe(-1)
  const second = await host.create(input())
  expect(workers).toHaveLength(2)
  await second.ready()
  expect((await second.waitForPendingDecision()).selections[0].length).toBeGreaterThan(0)
})

it('terminates rather than pools a worker whose session cleanup never finishes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-pool-cleanup-'))
  try {
    const file = join(directory, 'worker.mjs')
    await writeFile(
      file,
      `
      import {parentPort} from 'node:worker_threads';
      import {expose} from ${JSON.stringify(import.meta.resolve('comlink'))};
      import nodeEndpoint from ${JSON.stringify(import.meta.resolve('comlink/dist/esm/node-adapter.mjs'))};
      expose({initialize(){},health(){return {packages:0,state:'ready'}},endSession(){return new Promise(()=>{})}},nodeEndpoint(parentPort));
    `,
    )
    const { host, workers } = manager({ cleanupMs: 30 }, pathToFileURL(file))
    const battle = await host.create(input())
    await battle.cleanup()
    expect(host.status()[0]).toMatchObject({
      cleanup: 'terminated',
      cleanupFault: 'Graceful cleanup deadline exceeded',
    })
    expect(workers[0].threadId).toBe(-1)
    await (await host.create(input())).cleanup()
    expect(workers).toHaveLength(2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('expands to active capacity while retaining only one idle worker after a burst', async () => {
  const { host, workers } = manager({ maxBattles: 3, maxIdleWorkers: 1 })
  const burst = await Promise.all([host.create(input()), host.create(input()), host.create(input())])
  expect(host.poolStatus()).toEqual({ active: 3, preparing: 0, idle: 0, queued: 0, workers: 3, maxWorkers: 3 })
  await Promise.all(burst.map(battle => battle.cleanup()))
  expect(host.poolStatus()).toEqual({ active: 0, preparing: 0, idle: 1, queued: 0, workers: 1, maxWorkers: 3 })
  expect(workers.filter(worker => worker.threadId !== -1)).toHaveLength(1)
  const warm = await host.create(input())
  expect(workers).toHaveLength(3)
  await warm.cleanup()
})

it('admits queued battles FIFO, removes cancelled entries, and rejects overflow', async () => {
  const { host, workers } = manager({ maxQueuedBattles: 2 })
  const first = await host.create(input())
  const cancelled = new AbortController()
  const second = host.create(input(), cancelled.signal).catch(error => error)
  const order: string[] = []
  const third = host.create(input()).then(battle => {
    order.push('third')
    return battle
  })
  expect(host.poolStatus().queued).toBe(2)
  await expect(host.create(input())).rejects.toMatchObject({ reason: 'capacity' })
  cancelled.abort()
  expect(await second).toMatchObject({ reason: 'cancelled' })
  expect(host.poolStatus().queued).toBe(1)
  const fourth = host.create(input()).then(battle => {
    order.push('fourth')
    return battle
  })
  expect(workers).toHaveLength(1)
  await first.cleanup()
  const next = await third
  expect(order).toEqual(['third'])
  expect(host.poolStatus().queued).toBe(1)
  await next.cleanup()
  await (await fourth).cleanup()
  expect(order).toEqual(['third', 'fourth'])
  expect(workers).toHaveLength(1)
})

it('times out waiting admission and rejects queued launches on disposal', async () => {
  const { host, workers } = manager({ maxQueuedBattles: 2, queueTimeoutMs: 30 })
  await host.create(input())
  await expect(host.create(input())).rejects.toMatchObject({ reason: 'queue-timeout' })
  expect(host.poolStatus()).toMatchObject({ active: 1, queued: 0, workers: 1 })
  const queued = host.create(input()).catch(error => error)
  await host.dispose()
  expect(await queued).toMatchObject({ reason: 'disposed' })
  expect(workers).toHaveLength(1)
  expect(host.poolStatus()).toEqual({ active: 0, preparing: 0, idle: 0, queued: 0, workers: 0, maxWorkers: 1 })
})

it('captures queued environments and players before callers can modify them', async () => {
  const { host, workers } = manager({ maxQueuedBattles: 1 })
  const first = await host.create(input())
  const fingerprint = await first.getInitialFingerprint()
  const captured = input()
  const queued = host.create(captured)
  Object.assign(captured.environment.modules[0].artifact, { source: 'throw Error("mutated queued input")' })
  Object.assign(captured.players[0]!, { id: 'mutated-player' })
  await first.cleanup()
  const next = await queued
  expect(await next.getInitialFingerprint()).toEqual(fingerprint)
  expect(workers).toHaveLength(1)
  await next.cleanup()
})

it('holds admission capacity until excess idle workers really terminate', async () => {
  let release!: () => void
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  let started!: () => void
  const terminating = new Promise<void>(resolve => {
    started = resolve
  })
  const { host, workers } = manager({ maxIdleWorkers: 0, maxQueuedBattles: 1 }, undefined, async worker => {
    started()
    await held
    return worker.terminate()
  })
  const first = await host.create(input())
  const queued = host.create(input())
  const cleanup = first.cleanup()
  await terminating
  expect(host.poolStatus()).toMatchObject({ active: 1, idle: 0, queued: 1, workers: 1 })
  expect(workers).toHaveLength(1)
  release()
  await cleanup
  const second = await queued
  expect(workers[0].threadId).toBe(-1)
  expect(workers).toHaveLength(2)
  await second.cleanup()
  expect(host.poolStatus().workers).toBe(0)
})

it('evicts mismatched idle environments before admitting queued work without exceeding the worker cap', async () => {
  let release!: () => void
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  let started!: () => void
  const terminating = new Promise<void>(resolve => {
    started = resolve
  })
  const { host, workers } = manager({ maxQueuedBattles: 1 }, undefined, async worker => {
    started()
    await held
    return worker.terminate()
  })
  await (await host.create(input())).cleanup()
  const changed = input('export function createEffects(){return []}; const replacement = true')
  const replacing = host.create(changed)
  await terminating
  const queued = host.create(changed)
  expect(host.poolStatus()).toMatchObject({ active: 0, preparing: 1, queued: 1, workers: 1 })
  release()
  const next = await replacing
  expect(workers[0].threadId).toBe(-1)
  expect(host.poolStatus().workers).toBe(1)
  await next.cleanup()
  await (await queued).cleanup()
  expect(workers).toHaveLength(2)
})

it('validates independent idle and queue limits and allows explicitly disabling both', () => {
  expect(() => manager({ maxIdleWorkers: -1 })).toThrow(/Invalid Worker policy/)
  expect(() => manager({ maxIdleWorkers: 2 })).toThrow(/Invalid Worker policy/)
  expect(() => manager({ maxQueuedBattles: -1 })).toThrow(/Invalid Worker policy/)
  expect(() => manager({ queueTimeoutMs: 0 })).toThrow(/Invalid Worker policy/)
  expect(() => manager({ queueTimeoutMs: 2_147_483_648 })).toThrow(/Invalid Worker policy/)
  expect(() => manager({ queueTimeoutMs: 2_147_483_647 })).not.toThrow()
  expect(() => manager({ maxIdleWorkers: 0, maxQueuedBattles: 0 })).not.toThrow()
})

it('does not create another worker when disposal interrupts environment eviction', async () => {
  let release!: () => void
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  let started!: () => void
  const terminating = new Promise<void>(resolve => {
    started = resolve
  })
  const { host, workers } = manager({ maxQueuedBattles: 1 }, undefined, async worker => {
    started()
    await held
    return worker.terminate()
  })
  await (await host.create(input())).cleanup()
  const replacing = host
    .create(input('export function createEffects(){return []}; const replacement=true'))
    .catch(error => error)
  await terminating
  const queued = host.create(input()).catch(error => error)
  const disposing = host.dispose()
  release()
  await disposing
  expect(await replacing).toMatchObject({ reason: 'disposed' })
  expect(await queued).toMatchObject({ reason: 'disposed' })
  expect(workers).toHaveLength(1)
  expect(host.poolStatus()).toMatchObject({ active: 0, preparing: 0, idle: 0, queued: 0, workers: 0 })
})

it('stops the queue deadline when initialization starts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-pool-initialize-'))
  try {
    const file = join(directory, 'worker.mjs')
    await writeFile(
      file,
      `
      import {parentPort} from 'node:worker_threads';
      import {expose} from ${JSON.stringify(import.meta.resolve('comlink'))};
      import nodeEndpoint from ${JSON.stringify(import.meta.resolve('comlink/dist/esm/node-adapter.mjs'))};
      expose({initialize(){return new Promise(resolve=>setTimeout(resolve,100))},health(){},endSession(){}},nodeEndpoint(parentPort));
    `,
    )
    const { host, workers } = manager(
      { maxQueuedBattles: 1, queueTimeoutMs: 30, initializeMs: 1000 },
      pathToFileURL(file),
    )
    const first = await host.create(input())
    const queued = host.create(input())
    expect(host.poolStatus().queued).toBe(1)
    await first.cleanup()
    const next = await queued
    expect(host.poolStatus()).toMatchObject({ active: 1, queued: 0, workers: 1 })
    expect(workers).toHaveLength(1)
    await next.cleanup()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('reserves each physical slot across concurrent environment evictions', async () => {
  const { host, workers } = manager({ maxBattles: 3, maxQueuedBattles: 1 })
  const original = await Promise.all([host.create(input()), host.create(input()), host.create(input())])
  await Promise.all(original.map(battle => battle.cleanup()))
  expect(host.poolStatus().idle).toBe(3)
  const changed = input('export function createEffects(){return []}; const changed=true')
  const replacements = await Promise.all([host.create(changed), host.create(changed), host.create(changed)])
  expect(host.poolStatus()).toMatchObject({ active: 3, idle: 0, workers: 3 })
  expect(workers.slice(0, 3).every(worker => worker.threadId === -1)).toBe(true)
  await Promise.all(replacements.map(battle => battle.cleanup()))
})
