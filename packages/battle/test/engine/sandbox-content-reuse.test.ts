import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import officialEffectArtifact from '@arcadia-eternity/data-pack-base/effects?effect-module'
import { officialTemplateDefinitions } from '@arcadia-eternity/data-pack-base/effects'
import { LocalBattleSystem } from '../../host'
import { expect, it, vi } from 'vitest'
import { getQuickJS } from 'quickjs-emscripten'
import { Arena } from 'quickjs-emscripten-sync'
import { checkpointArena, registerArenaProjection, releaseArenaSession } from '../../src/sandbox/arena-session'
import { prepareSandboxContent } from '../../src/sandbox/content'
import { ArenaEffectModule } from '../../src/sandbox/effect-module'
import { sandboxPolicy } from '../../src/sandbox/contracts'
import * as sdk from '../../authoring'
import type { SandboxEnvironment } from '../../src/sandbox/runtime'
import { EffectContext, EffectTrigger, TurnContext } from '../../engine'
import input from '../fixtures/official-switch.input.json'

it('releases automatic marshalled views and explicit identities at each Arena session boundary', async () => {
  const context = (await getQuickJS()).newContext()
  const arena = new Arena(context, { isMarshalable: true })
  try {
    arena.expose({ fixed: { value: 7 } })
    const baseline = checkpointArena(arena)
    const objects = () => {
      const usage = context.runtime.computeMemoryUsage()
      try {
        return (context.dump(usage) as { obj_count: number }).obj_count
      } finally {
        usage.dispose()
      }
    }
    const counts: number[] = []
    for (let i = 0; i < 1200; i++) {
      const original = { hp: 20 }
      const view = Object.create(null) as { hp: number }
      Object.defineProperty(view, 'hp', { get: () => original.hp })
      registerArenaProjection(arena, original, view)
      arena.expose({ current: original })
      expect(arena.evalCode('current.hp + fixed.value')).toBe(27)
      arena.evalCode('delete globalThis.current')
      releaseArenaSession(arena, baseline)
      const after = checkpointArena(arena)
      expect(after.marshalled).toEqual(baseline.marshalled)
      expect(after.registered).toEqual(baseline.registered)
      counts.push(objects())
    }
    // QuickJS collects Proxy/handler cycles on allocation, not immediately when
    // their last host handle is disposed. Repeated collections must return to
    // the same live-object baseline rather than retain each completed lease.
    const collected = counts.filter((count, index) => index > 0 && count < counts[index - 1])
    expect(collected.length).toBeGreaterThan(1)
    expect(Math.max(...collected)).toBeLessThanOrEqual(counts[0] + 32)
    expect(arena.evalCode('fixed.value')).toBe(7)
  } finally {
    arena.dispose()
    context.dispose()
  }
})

function environment(): SandboxEnvironment {
  return {
    revision: 'reuse/1',
    modules: [3, 7].map((amount, index) => ({
      namespace: `p${index}`,
      role: 'catalog',
      artifact: {
        format: 'arcadia.effect-module',
        version: 1,
        sdkApi: 2,
        packageId: `p${index}`,
        // Each module deliberately declares the same lexical names and exports.
        source: `const amount=${amount};
          export function createCatalog(){
            const effect=sdk.defineNativeEffect({id:'p${index}/heal',triggers:[sdk.EffectTrigger.TurnEnd],
              apply(ctx){const pet=ctx.source.owner;
                pet.heal(new sdk.HealContext(ctx,ctx.source,pet,amount));
              }});
            return {effects:new Map([[effect.id,effect]]),parameters:new Map()};
          }`,
      },
    })),
    data: {
      marks: [],
      skills: [
        {
          id: 'strike',
          element: 'Normal',
          category: 'Physical',
          power: 20,
          rage: 0,
          accuracy: 100,
          effect: ['p0/heal', 'p1/heal'],
        },
      ],
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
  }
}
const players = () =>
  input.teams.map((player, index) => ({
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
  }))
it.each(['package', 'environment'] as const)(
  'reuses prepared %s logic across clean native battle sessions',
  async grouping => {
    const prepared = await prepareSandboxContent(environment(), { grouping })
    const { content } = prepared
    const effects = content.effects
    try {
      expect(prepared.packageCount).toBe(2)
      expect(prepared.vmCount).toBe(grouping === 'package' ? 2 : 1)
      for (let i = 0; i < 12; i++) {
        prepared.beginSession()
        const [a, b] = content.parsePlayers(players())
        const battle = content.createBattle(a, b, { rngSeed: 'reuse', timerConfig: { enabled: false } })
        try {
          a.activePet.currentHp = 20
          for (const effect of effects) {
            effect.innerApply(
              new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, a.activePet.skills[0], effect),
            )
          }
          expect(a.activePet.currentHp).toBe(30)
          expect(content.effects).toBe(effects)
          prepared.assertHealthy()
        } finally {
          await battle.cleanup()
          prepared.endSession()
        }
      }
    } finally {
      prepared.dispose()
    }
  },
)

it('reuses the complete official catalog after actions, cleanup and checkpoint restoration', async () => {
  const root = new URL('../../../../packs/base/', import.meta.url)
  const manifest = JSON.parse(readFileSync(new URL('pack.json', root), 'utf8'))
  const read = (kind: string) =>
    manifest.data[kind].flatMap((file: string) =>
      parse(readFileSync(new URL(`data/${file}`, root), 'utf8'), { merge: true }),
    )
  const prepared = await prepareSandboxContent(
    {
      revision: 'official-reuse',
      data: {
        marks: read('marks'),
        skills: read('skills'),
        species: read('species'),
        behaviors: officialTemplateDefinitions,
      },
      modules: [{ artifact: officialEffectArtifact, role: 'catalog', namespace: '' }],
    },
    { grouping: 'environment' },
  )
  const options = { rngSeed: input.seed, showHidden: true, allowFaintSwitch: true, timerConfig: { enabled: false } }
  const create = () => {
    prepared.beginSession()
    const [a, b] = prepared.content.parsePlayers(structuredClone(input.teams))
    return new LocalBattleSystem(prepared.content.createBattle(a, b, options), prepared.content)
  }
  let first: LocalBattleSystem | undefined
  let second: LocalBattleSystem | undefined
  try {
    first = create()
    await first.ready()
    for (let turn = 0; turn < 3; turn++) {
      const pending = await first.waitForPendingDecision()
      for (const choices of pending.selections) {
        const action =
          choices.find(action => action.type === 'use-skill') ?? choices.find(action => action.type !== 'surrender')
        if (action) await first.submitAction(action)
      }
    }
    await first.waitForPendingDecision()
    const checkpoint = await first.createRuntimeSnapshot()
    const state = await first.getState(undefined, true)
    await first.cleanup()
    first = undefined
    prepared.endSession()
    second = create()
    await second.restoreRuntimeSnapshot(checkpoint)
    await second.ready()
    expect(await second.getState(undefined, true)).toEqual(state)
    const pending = await second.waitForPendingDecision()
    expect(pending.selections.some(choices => choices.length > 0)).toBe(true)
    for (const choices of pending.selections) {
      const action =
        choices.find(action => action.type === 'use-skill') ?? choices.find(action => action.type !== 'surrender')
      if (action) await second.submitAction(action)
    }
    await second.waitForPendingDecision()
    prepared.assertHealthy()
    await second.cleanup()
    second = undefined
    prepared.endSession()
  } finally {
    await first?.cleanup()
    await second?.cleanup()
    prepared.dispose()
  }
}, 30_000)

it('keeps authored counters on each battle entity while reusing the same effect declaration', async () => {
  const spec = environment()
  const modules: SandboxEnvironment['modules'] = [
    {
      ...spec.modules[0],
      artifact: {
        ...spec.modules[0].artifact,
        source: `
    const hits=sdk.defineEffectState({id:'p0:hits',type:'number',default:0});
    export function createCatalog(){
      const effect=sdk.defineNativeEffect({id:'p0/heal',triggers:[sdk.EffectTrigger.TurnEnd],
        apply(ctx){
          const n=sdk.getEffectState(ctx,ctx.source,hits)+1;
          sdk.setEffectState(ctx,ctx.source,hits,n);
          const pet=ctx.source.owner;
          pet.heal(new sdk.HealContext(ctx,ctx.source,pet,n));
        }});
      return {effects:new Map([[effect.id,effect]]),parameters:new Map()};
    }`,
      },
    },
  ]
  const prepared = await prepareSandboxContent(
    {
      ...spec,
      modules,
      data: { ...spec.data, skills: spec.data.skills.map(skill => ({ ...(skill as object), effect: ['p0/heal'] })) },
    },
    { grouping: 'environment' },
  )
  try {
    for (let session = 0; session < 3; session++) {
      prepared.beginSession()
      const [a, b] = prepared.content.parsePlayers(players())
      const battle = prepared.content.createBattle(a, b, { rngSeed: 'entity-state', timerConfig: { enabled: false } })
      try {
        a.activePet.currentHp = 20
        const effect = prepared.content.effects[0]
        for (let invocation = 0; invocation < 2; invocation++)
          effect.innerApply(
            new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, a.activePet.skills[0], effect),
          )
        expect(a.activePet.currentHp).toBe(23)
        prepared.assertHealthy()
      } finally {
        await battle.cleanup()
        prepared.endSession()
      }
    }
  } finally {
    prepared.dispose()
  }
})

it('resets the per-session call budget while retaining a fault permanently', async () => {
  const module = await ArenaEffectModule.prepare(
    {
      format: 'arcadia.effect-module',
      version: 1,
      sdkApi: 2,
      packageId: 'budget',
      source: 'export function createEffects(){return []}',
    },
    { ...sandboxPolicy, callsPerSession: 12 },
  )
  const context = { sdk, marks: new Map(), id: (id: string) => id }
  try {
    for (let session = 0; session < 3; session++) {
      module.beginSession()
      for (let invocation = 0; invocation < 8; invocation++) module.createEffects(context)
      module.endSession()
    }
    module.beginSession()
    expect(() => {
      for (let invocation = 0; invocation < 20; invocation++) module.createEffects(context)
    }).toThrow(/budget/)
    expect(() => module.endSession()).toThrow(/budget/)
    expect(() => module.beginSession()).toThrow(/budget/)
    expect(module.state).toBe('faulted')
  } finally {
    module.dispose()
  }
})

it('owns projection identity handles independently and releases them on unregister or failure', async () => {
  const context = (await getQuickJS()).newContext()
  const arena = new Arena(context, { isMarshalable: true })
  try {
    const baseline = checkpointArena(arena)
    const original = {},
      view = { hp: 20 }
    registerArenaProjection(arena, original, view)
    const identity = arena._registeredMap.get(original)!
    const projected = arena._map.get(view)!
    expect(identity).not.toBe(projected)
    expect(context.sameValue(identity, projected)).toBe(true)
    expect(arena._registeredMapDispose.has(original)).toBe(true)
    const entries = arena._map.size
    registerArenaProjection(arena, original, { hp: 90 })
    expect(arena._registeredMap.get(original)).toBe(identity)
    expect(arena._map.size).toBe(entries)
    arena.unregister(original)
    expect(identity.alive).toBe(false)
    expect(projected.alive).toBe(true)
    expect(arena._registeredMapDispose.has(original)).toBe(false)
    releaseArenaSession(arena, baseline)
    expect(projected.alive).toBe(false)
    expect(() => releaseArenaSession(arena, baseline)).not.toThrow()

    const rejected = {}
    let borrowed: typeof identity | undefined
    const register = vi.spyOn(arena, 'register').mockImplementation((_original, handle) => {
      if (typeof handle !== 'string') borrowed = handle
      throw Error('registration failed')
    })
    expect(() => registerArenaProjection(arena, rejected, { hp: 10 })).toThrow('registration failed')
    expect(borrowed?.alive).toBe(false)
    expect(arena._registeredMap.has(rejected)).toBe(false)
    register.mockRestore()
    releaseArenaSession(arena, baseline)
    expect(checkpointArena(arena)).toEqual(baseline)
    expect(arena.evalCode('Object.hasOwn(globalThis,"__arcadiaSdkValue")')).toBe(false)
  } finally {
    arena.dispose()
    context.dispose()
  }
})
