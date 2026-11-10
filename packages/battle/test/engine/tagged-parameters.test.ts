import { TaggedParametersEffects } from '../../../../packs/base/src/effects/tagged-parameters.effect'
import {
  BaseMark,
  BattleMessageType,
  ConfigModifierType,
  EffectContext,
  EffectTrigger,
  ParameterCatalog,
  RemoveMarkContext,
  SnapshotCatalog,
  TurnContext,
  defineParameter,
  parameterAddress,
  restoreBattle,
  setGlobalLogger,
  snapshotBattle,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/engine'

import { Type } from '@sinclair/typebox'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { makeScenario } from './scenario'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
it('restores tagged modifiers with a fresh catalog and keeps source cleanup working', async () => {
  function freshCatalog(
    f = makeScenario(752),
    effect = TaggedParametersEffects.build().effect_emblem_increase_skill_trigger_rate_5_percent,
  ) {
    if (!battles.includes(f.battle)) battles.push(f.battle)
    const catalog = new SnapshotCatalog('tagged-parameters/1')
    for (const pet of [...f.a.team, ...f.b.team])
      for (const skill of pet.skills)
        for (const item of [...skill.base.effects, ...skill.effects]) catalog.registerEffect(item.id, item)
    for (const effect of f.debuff.effects) catalog.registerEffect(effect.id, effect)
    catalog.registerEffect(effect.id, effect)
    return catalog
  }
  const fixture = makeScenario(753)
  const { battle, a, b, debuff } = fixture
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const source = new BaseMark(
    'fixture/saved-tag-source' as baseMarkId,
    [TaggedParametersEffects.build().effect_emblem_increase_skill_trigger_rate_5_percent],
    { ...debuff.config, persistent: true, keepOnSwitchOut: true },
  ).createInstance()
  source.setOwner(a.activePet, battle.emitter)
  a.activePet.marks.push(source)
  const parameter = () =>
    defineParameter({
      address: parameterAddress('saved', 'first', 'chance'),
      schema: Type.Number(),
      effectiveSchema: Type.Number(),
      value: 40,
      operations: [ConfigModifierType.delta],
      aliases: ['saved.chance'],
      tags: ['skill_effect_probability'],
    })
  const params = new ParameterCatalog([parameter()])
  params.install(battle.configSystem)
  const ready = new Promise<void>(resolve =>
    battle.registerListener(message => {
      if (message.type === BattleMessageType.TurnAction) resolve()
    }),
  )
  const running = battle.startBattle().catch(() => {})
  await ready
  expect(params.read(battle.configSystem, 'saved.chance', a.activePet.skills[0])).toBe(45)
  const saved = JSON.parse(JSON.stringify(snapshotBattle(battle, freshCatalog(fixture, source.effects[0]))))
  await battle.cleanup()
  await running
  const restored = restoreBattle(saved, freshCatalog())
  battles.push(restored)
  const freshParams = new ParameterCatalog([parameter()]),
    pet = restored.playerA.activePet
  expect(freshParams.read(restored.configSystem, 'saved.chance', pet.skills[0])).toBe(45)
  const mark = pet.marks.find(mark => mark.baseId === 'fixture/saved-tag-source')!
  restored.removeMark(
    new RemoveMarkContext(new EffectContext(new TurnContext(restored), EffectTrigger.TurnEnd, pet.skills[0]), mark),
  )
  expect(freshParams.read(restored.configSystem, 'saved.chance', pet.skills[0])).toBe(40)
})
