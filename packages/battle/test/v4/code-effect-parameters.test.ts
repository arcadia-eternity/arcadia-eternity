import { afterEach, expect, it } from 'vitest'
import {
  AddMarkContext,
  AttackTargetOpinion,
  BaseMark,
  EffectContext,
  EffectTrigger,
  RemoveMarkContext,
  TurnContext,
  UseSkillContext,
  compileBehaviorUse,
  parameterAddress,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import {
  codeEffectDefinition,
  defineCodeEffect,
  numberParam,
  ops,
  targets,
} from '@arcadia-eternity/battle/v4/authoring'
import { makeScenario } from './scenario'

const battles: Battle[] = []
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})

it('keeps runtime parameters modifiable by other effects without an editor form or serialized parameter payload', () => {
  const recovery = defineCodeEffect({
    id: 'code:recovery',
    sourceKind: 'skill',
    build({ effectId }) {
      const amount = numberParam({ default: 5, tags: ['code:healing'] })
      return { id: effectId, on: 'OnHit', parameters: { amount }, execute: targets.ownerPet.apply(ops.heal(amount)) }
    },
  })
  const definition = codeEffectDefinition(recovery)
  expect(definition.parameters).toEqual({})
  const compiled = ['first', 'second'].map(useId => {
    const result = compileBehaviorUse(
      definition,
      { useId, definitionId: recovery.id },
      {
        owner: { kind: 'skill', id: 'fixture/setup' },
        nativeExports: [recovery],
      },
    )
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
    return result
  })
  const booster = new BaseMark('code:booster' as baseMarkId, [])
  const boost = defineCodeEffect({
    id: 'code:boost',
    sourceKind: 'petMark',
    build: ({ effectId }) => ({
      id: effectId,
      on: 'OnMarkCreated',
      execute: targets.ownerPet.apply(ops.addTaggedParameterModifier('code:healing', 'delta', 10)),
    }),
  })
  const modifier = compileBehaviorUse(
    codeEffectDefinition(boost),
    { useId: 'boost', definitionId: boost.id },
    {
      owner: { kind: 'petMark', id: booster.id },
      sourceMark: booster,
      nativeExports: [boost],
    },
  )
  if (!modifier.ok) throw new Error(JSON.stringify(modifier.diagnostics))
  booster.effects.push(modifier.effect)
  const first = makeScenario(242),
    second = makeScenario(242)
  battles.push(first.battle, second.battle)
  for (const fixture of [first, second]) {
    for (const use of compiled) use.parameters.install(fixture.battle.configSystem)
    const skill = fixture.a.activePet.skills[0]
    skill.effects.splice(0, skill.effects.length, ...compiled.map(use => use.effect))
    fixture.a.activePet.currentHp = 1
  }
  const apply = (fixture: typeof first) => {
    const skill = fixture.a.activePet.skills[0]
    fixture.battle.applyEffects(
      new UseSkillContext(
        new TurnContext(fixture.battle),
        fixture.a,
        fixture.a.activePet,
        AttackTargetOpinion.opponent,
        skill,
      ),
      EffectTrigger.OnHit,
      skill,
    )
  }
  const trigger = new EffectContext(new TurnContext(first.battle), EffectTrigger.TurnStart, first.a.activePet.skills[0])
  first.battle.addMark(new AddMarkContext(trigger, first.a.activePet, booster))
  apply(first)
  apply(second)
  expect(first.a.activePet.currentHp).toBe(31) // two independent uses, each (5 + 10)
  expect(second.a.activePet.currentHp).toBe(11) // other battle retains both defaults
  const address = parameterAddress(compiled[0].effect.id, 'parameters', 'amount')
  compiled[0].parameters.set(first.battle.configSystem, address, 7)
  first.a.activePet.currentHp = 1
  apply(first)
  expect(first.a.activePet.currentHp).toBe(33) // only the first use has a changed base
  const mark = first.a.activePet.marks.find(mark => mark.baseId === booster.id)!
  first.battle.removeMark(new RemoveMarkContext(trigger, mark))
  first.a.activePet.currentHp = 1
  apply(first)
  expect(first.a.activePet.currentHp).toBe(13) // source cleanup removes both +10 modifiers
})
