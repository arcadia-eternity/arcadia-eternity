import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  createCoreCapabilityRegistry,
  parameterAddress,
  compileRule,
  EffectTrigger,
  BattleMessageType,
  UseSkillContext,
  TurnContext,
  AttackTargetOpinion,
  defineNativeEffect,
  EffectContext,
  ConfigModifier,
  ConfigModifierType,
  ConfigDurationType,
  BaseMark,
  AddMarkContext,
  setGlobalLogger,
  type Battle,
  type effectId,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const example = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/examples/ugc-healing.json', import.meta.url), 'utf8'),
)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function setup(input = example, kind: 'skill' | 'petMark' = 'skill') {
  const f = makeScenario()
  battles.push(f.battle)
  const result = compileRule(input, createCoreCapabilityRegistry(), { contentId: 'ugc-healing', sourceKind: kind })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  result.parameters.install(f.battle.configSystem)
  const pet = f.a.activePet
  pet.attributeSystem.updateBaseValue('maxHp', 401)
  pet.currentHp = 100
  const skill = pet.skills[0]
  const use = new UseSkillContext(new TurnContext(f.battle), f.a, pet, AttackTargetOpinion.opponent, skill)
  return { ...f, pet, skill, use, result }
}

it('executes the saved UGC example and keeps author-editable arguments through JSON recompilation', () => {
  const { battle, pet, skill, use, result } = setup()
  skill.effects.push(result.effect)
  battle.applyEffects(use, EffectTrigger.OnHit, skill)
  expect(pet.currentHp).toBe(200)
  const again = compileRule(JSON.parse(JSON.stringify(result.rule)), createCoreCapabilityRegistry(), {
    contentId: 'copy',
    sourceKind: 'skill',
  })
  expect(again.ok).toBe(true)
  if (again.ok)
    expect(again.parameterDefinitions.map(p => p.address)).toEqual(result.parameterDefinitions.map(p => p.address))
  const edited = structuredClone(example)
  edited.parameters.healing.value = 0.5
  const other = setup(edited)
  other.skill.effects.push(other.result.effect)
  other.battle.applyEffects(other.use, EffectTrigger.OnHit, other.skill)
  expect(other.pet.currentHp).toBe(300)
})

it('reads the threshold at collection and the healing parameter after BeforeEffect', () => {
  const { battle, pet, skill, use, result } = setup()
  skill.effects.push(result.effect)
  const removers: (() => void)[] = []
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/change-healing' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === result.effect.id,
      apply() {
        for (const [name, value] of [
          ['threshold', 0],
          ['healing', 0.5],
        ] as const) {
          const parameter = result.parameterDefinitions.find(
            p => p.address === parameterAddress(result.rule.id, example.parameters[name].nodeId, name),
          )!
          removers.push(
            result.parameters.modify(
              battle.configSystem,
              parameter,
              new ConfigModifier(ConfigDurationType.binding, `change-${name}`, value, ConfigModifierType.override, 0),
              skill,
            ),
          )
        }
      },
    }),
  )
  battle.applyEffects(use, EffectTrigger.OnHit, skill)
  expect(pet.currentHp).toBe(300)
  pet.currentHp = 100
  battle.applyEffects(use, EffectTrigger.OnHit, skill)
  expect(pet.currentHp).toBe(100)
  removers.forEach(remove => remove())
})

it('supports owner marks but does not admit an unrelated skill or field mark', () => {
  const { battle, pet, skill, use, result, debuff, b } = setup(example, 'petMark')
  const base = new BaseMark('ugc/healing-mark' as baseMarkId, [result.effect], debuff.config)
  battle.addMark(
    new AddMarkContext(new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill), pet, base),
  )
  battle.applyEffects(use, EffectTrigger.OnHit, pet.marks[0])
  expect(pet.currentHp).toBe(200)
  const field = compileRule(example, createCoreCapabilityRegistry(), { contentId: 'field', sourceKind: 'battleMark' })
  expect(field.ok).toBe(false)
  const ownSkill = setup()
  ownSkill.skill.effects.push(ownSkill.result.effect)
  ownSkill.use.skill = b.activePet.skills[0]
  ownSkill.battle.applyEffects(ownSkill.use, EffectTrigger.OnHit, ownSkill.skill)
  expect(ownSkill.pet.currentHp).toBe(100)
})

it('runs independently configured ordered actions with schema defaults', () => {
  const input = {
    formatVersion: 1,
    id: 'ordered-healing',
    trigger: { nodeId: 'hit', id: 'core.selfSkillHit' },
    actions: [
      { stepId: 'fixed', id: 'core.healOwner', params: { amount: 10 } },
      { stepId: 'fraction', id: 'core.healOwnerByMaxHp' },
    ],
  }
  const { battle, pet, skill, use, result } = setup(input)
  const amounts: number[] = []
  battle.registerListener(message => {
    if (message.type === BattleMessageType.Heal) amounts.push(message.data.amount)
  })
  skill.effects.push(result.effect)
  battle.applyEffects(use, EffectTrigger.OnHit, skill)
  expect(pet.currentHp).toBe(310)
  expect(amounts).toEqual([10, 200])
  expect(result.rule.actions[1].params).toEqual({ ratio: 0.5 })
  const actions = createCoreCapabilityRegistry().describeActions()
  expect(actions.find(action => action.id === 'core.healOwnerByMaxHp')?.publicParams.ratio).toBeDefined()
})

it.each([{ ratio: -1 }, { ratio: 2 }, { ratio: 0.5, code: 'arbitrary code' }])(
  'rejects invalid author arguments %j',
  params => {
    const input = structuredClone(example)
    input.actions[0].params = params
    expect(compileRule(input, createCoreCapabilityRegistry(), { contentId: 'invalid', sourceKind: 'skill' }).ok).toBe(
      false,
    )
  },
)
