import { expect, it } from 'vitest'
import {
  AddMarkContext,
  BattleMessageType,
  EffectContext,
  EffectTrigger,
  StackStrategy,
  TurnContext,
  lockContentEnvironment,
  compileContentPack,
  setGlobalLogger,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

it('restores a saved pack binding with fresh registered factories and saved instance parameters', async () => {
  setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
  const text = JSON.stringify({
    formatVersion: 1,
    id: 'controlled-pack',
    marks: [
      {
        id: 'controlled-pack/source',
        config: { duration: 10, persistent: true, stackable: true, maxStacks: 5, stackStrategy: StackStrategy.stack },
        instanceParams: { bonus: { presetId: 'core.amount', value: 3 } },
        effects: ['controlled-pack/stack'],
      },
    ],
    rules: [
      {
        sourceKind: 'petMark',
        rule: {
          formatVersion: 1,
          id: 'controlled-pack/stack',
          sourceMarkId: 'controlled-pack/source',
          trigger: { nodeId: 'created', id: 'core.markCreated' },
          values: [
            { nodeId: 'owner', id: 'core.ownerPet' },
            { nodeId: 'source', id: 'core.sourceMark' },
            { nodeId: 'first', id: 'core.firstMark', inputs: { target: { node: 'source' } } },
            { nodeId: 'follow', id: 'core.followMark', inputs: { target: { node: 'first' } } },
            {
              nodeId: 'stack',
              id: 'core.boundMarkStack',
              params: { mode: 'follow' },
              inputs: { target: { node: 'follow' } },
            },
            { nodeId: 'bonus', id: 'core.followNumber', inputs: { value: { instanceParameter: 'bonus' } } },
            {
              nodeId: 'amount',
              id: 'core.multiplyBinding',
              inputs: { left: { node: 'stack' }, right: { node: 'bonus' } },
            },
          ],
          actions: [
            {
              stepId: 'speed',
              id: 'core.bindAttribute',
              params: { attribute: 'spe', operation: 'delta', lifetime: 'sourceMark', missing: 'detach' },
              inputs: { target: { node: 'owner' }, value: { node: 'amount' } },
            },
          ],
        },
      },
    ],
  })
  const build = { formatVersion: 1 as const, coreBuildId: 'a'.repeat(64), registryBuildId: 'b'.repeat(64) }
  const environment = await lockContentEnvironment([text], build)
  const f = makeScenario(242)
  for (const pet of [...f.a.team, ...f.b.team])
    for (const skill of pet.skills) {
      skill.effects.splice(0)
      skill.base.effects.splice(0)
    }
  environment.install(f.battle)
  let restored: typeof f.battle | undefined
  let running: Promise<unknown> | undefined
  try {
    const ready = new Promise<void>(resolve =>
      f.battle.registerListener(message => {
        if (message.type === BattleMessageType.TurnAction) resolve()
      }),
    )
    running = f.battle.startBattle().catch(error => {
      if (!(error instanceof Error) || error.message !== 'Battle cancelled') throw error
    })
    await Promise.race([
      ready,
      running.then(() => {
        throw new Error('Battle ended before checkpoint')
      }),
    ])
    const pet = f.a.activePet
    pet.attributeSystem.updateBaseValue('spe', 300)
    const context = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, pet.skills[0])
    f.battle.addMark(new AddMarkContext(context, pet, environment.packs[0].marks[0], 2, 10, undefined, { bonus: 5 }))
    expect(pet.stat.spe).toBe(310)
    const snapshot = JSON.parse(JSON.stringify(environment.snapshot(f.battle)))
    await f.battle.cleanup()
    await running
    const fresh = await lockContentEnvironment(
      [JSON.stringify(environment.packs[0].data)],
      build,
      environment.manifest.environmentDigest,
    )
    restored = fresh.restore(snapshot)
    const restoredPet = restored.playerA.activePet
    const source = restoredPet.marks.find(mark => mark.baseId === 'controlled-pack/source')!
    expect(source.base).toBe(fresh.packs[0].marks[0])
    expect(source.instanceParams).toEqual({ bonus: 5 })
    expect(restoredPet.stat.spe).toBe(310)
    source.stack = 3
    expect(restoredPet.stat.spe).toBe(315)
    source.consumeStack(new EffectContext(new TurnContext(restored), EffectTrigger.TurnStart, restoredPet.skills[0]), 3)
    expect(restoredPet.stat.spe).toBe(300)
  } finally {
    await restored?.cleanup()
    await f.battle.cleanup()
    await running
  }
})

it('locates malformed saved rule slots through the pack entry before activation', () => {
  const saved = JSON.stringify({
    formatVersion: 1,
    id: 'controlled-pack',
    rules: [
      {
        sourceKind: 'skill',
        rule: {
          formatVersion: 1,
          id: 'controlled-pack/damage',
          trigger: { nodeId: 'hit', id: 'core.selfSkillHit' },
          actions: [{ stepId: 'damage', id: 'core.dealDamage', inputs: { amount: 1 } }],
        },
      },
    ],
  })
  expect(compileContentPack(JSON.parse(saved))).toMatchObject({
    ok: false,
    diagnostics: [
      {
        code: 'INVALID_PARAMETERS',
        contentId: 'controlled-pack/damage',
        ruleId: 'controlled-pack/damage',
        nodeId: 'damage',
        field: '/rules/0/rule/actions/0/inputs/amount',
      },
    ],
  })
})
