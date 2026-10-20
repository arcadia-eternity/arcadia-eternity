import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  createRainWaterShield,
  createOfficialWaterShieldCandidate,
  BaseMark,
  BaseSkill,
  SkillInstance,
  Category,
  Element,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  SkillPhase,
  defineNativeEffect,
  ConfigModifier,
  ConfigModifierType,
  ConfigDurationType,
  setGlobalLogger,
  effectAuthoring,
  type Battle,
  type baseMarkId,
  type baseSkillId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const id = 'effect_ability_add_shuiwenpingzhang_value_if_yutian'
const alias = 'effect_skill_add_mark_shuiwenpingzhang.multiply_value'
const original = parse(
  readFileSync(new URL('../../../../packs/base/data/effect_ability.yaml', import.meta.url), 'utf8'),
  { merge: true },
).find((entry: { id: string }) => entry.id === id)
function reference() {
  const d = structuredClone(original)
  expect(d.condition.conditions[1].target.chain[0].arg).toBe('skillId')
  d.condition.conditions[1].target.chain[0].arg = 'skill'
  return EffectParser.parse(d)
}
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'dry',
  'rain',
  'late-rain',
  'late-dry',
  'wrong-skill',
  'wrong-owner',
  'cancel',
  'repeat',
  'modifier',
  'late-skill',
  'detach-source',
  'real-skill',
] as const
function run(native: boolean, kind: 'mark' | 'skill', variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(183)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) for (const skill of pet.skills) skill.effects.splice(0)
  const skill = new SkillInstance(
    new BaseSkill(
      (variant === 'wrong-skill' ? 'fixture/other' : 'skill_shuiwenpingzhang') as baseSkillId,
      Category.Status,
      Element.Water,
      0,
      100,
      0,
      0,
      AttackTargetOpinion.opponent,
    ),
  )
  skill.setOwner(a.activePet)
  a.activePet.skills[0] = skill
  const sourceMark = new BaseMark('fixture/rain-source' as baseMarkId, [], {
    ...debuff.config,
    persistent: true,
    duration: -1,
  }).createInstance()
  sourceMark.setOwner(a.activePet, battle.emitter)
  a.activePet.marks.push(sourceMark)
  const source = kind === 'mark' ? sourceMark : skill
  const mark = new BaseMark('mark_shuiwenpingzhang' as baseMarkId, [], {
    ...debuff.config,
    maxStacks: 10000,
  })
  const shield = createOfficialWaterShieldCandidate(mark)
  const key = native ? shield.multiplier.address : alias
  if (native) shield.parameters.install(battle.configSystem)
  else battle.configSystem.registerConfig(key, 1)
  const effect = native ? createRainWaterShield(shield.parameters) : reference()
  source.effects.push(effect)
  if (variant === 'wrong-owner') source.owner = b.activePet
  const weather = (rain: boolean) => {
    battle.marks.splice(0)
    if (rain) {
      const instance = new BaseMark('mark_global_yutian' as baseMarkId, []).createInstance()
      instance.setOwner(battle, battle.emitter)
      battle.marks.push(instance)
    }
  }
  weather(!['dry', 'late-rain'].includes(variant))
  const turn = new TurnContext(battle)
  const event = new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, skill)
  const trace: number[] = []
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/rain-observer' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id,
      apply: ctx => {
        trace.push(battle.configSystem.get(key, skill) as number)
        if (ctx.parent instanceof EffectContext && variant === 'cancel') ctx.parent.available = false
        if (variant === 'late-rain') weather(true)
        if (variant === 'late-dry') weather(false)
        if (variant === 'late-skill') event.skill = b.activePet.skills[0]
      },
    }),
  )
  if (variant === 'modifier')
    battle.configSystem.addScopedConfigModifier(
      key,
      new ConfigModifier(ConfigDurationType.binding, 'fixture/rain-delta', 0.25, ConfigModifierType.delta, 0),
      a.activePet,
    )
  if (variant === 'real-skill') {
    // Native integration uses the real shield reader and SkillPhase. The legacy
    // comparison above exercises the independently parsed ability itself.
    if (!native) throw new Error('Native integration only')
    skill.effects.push(shield.effect)
    const phase = new SkillPhase(battle, a, a.activePet, AttackTargetOpinion.opponent, skill, turn)
    battle.phaseManager.registerPhase(phase)
    expect(battle.phaseManager.executePhase(phase.id).success).toBe(true)
    expect(a.activePet.marks.find(m => m.base === mark)?.stack).toBe(
      Math.floor(Math.floor(a.activePet.stat.maxHp / 4) * 1.5),
    )
  } else {
    battle.applyEffects(event, EffectTrigger.BeforeHit, source)
  }
  const first = battle.configSystem.get(key, skill)
  if (variant === 'detach-source') sourceMark.detach()
  if (variant === 'repeat') {
    weather(false)
    battle.applyEffects(event, EffectTrigger.BeforeHit, source)
  }
  return {
    first,
    final: battle.configSystem.get(key, skill),
    opponent: battle.configSystem.get(key, b.activePet),
    trace,
  }
}

it('samples a scoped assignment once, rejects foreign writes, and validates base values', () => {
  const { battle, a, b, debuff } = makeScenario()
  const foreign = makeScenario()
  battles.push(battle, foreign.battle)
  const shield = createOfficialWaterShieldCandidate(
    new BaseMark('mark_shuiwenpingzhang' as baseMarkId, [], debuff.config),
  )
  shield.parameters.install(battle.configSystem)
  const { compileEffect, defineEffect, ops, values, targets } = effectAuthoring
  let reads = 0
  let checked = false
  const amount = values.choose(
    () => {
      reads++
      return true
    },
    2,
    1,
  )
  const assign = ops.setParameter(shield.parameters, alias, amount)
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/scoped-assignment',
      on: 'BeforeHit',
      execute: ctx => {
        expect(() => assign(ctx, [a.activePet, foreign.a.activePet])).toThrow('Cross-battle')
        expect(reads).toBe(0)
        assign(ctx, [a.activePet, b.activePet])
        expect(reads).toBe(1)
        assign(ctx, [])
        expect(reads).toBe(2)
        ops.setParameter(
          shield.parameters,
          alias,
          targets.sourceMark.select(mark => mark.stack).first(),
        )(ctx, [a.activePet])
        expect(shield.parameters.read(battle.configSystem, alias, a.activePet)).toBe(2)
        expect(() => ops.setParameter(shield.parameters, alias, NaN)(ctx, [a.activePet])).toThrow()
        checked = true
      },
    }),
  )
  const source = a.activePet.skills[0]
  source.effects.splice(0, source.effects.length, effect)
  battle.applyEffects(
    new UseSkillContext(new TurnContext(battle), a, a.activePet, AttackTargetOpinion.opponent, source),
    EffectTrigger.BeforeHit,
    source,
  )
  expect(checked).toBe(true)
  expect(shield.parameters.read(battle.configSystem, alias, b.activePet)).toBe(2)
  expect(() => shield.parameters.set(battle.configSystem, alias, 'bad', a.activePet)).toThrow('Invalid base')
  expect(() => shield.parameters.set(foreign.battle.configSystem, alias, 3)).toThrow('not installed')
})
it('requires only the reviewed V1 skillId path correction', () => {
  expect(() => EffectParser.parse(original)).toThrow()
  expect(() => reference()).not.toThrow()
})
for (const kind of ['skill', 'mark'] as const) {
  it.each(variants.filter(v => v !== 'real-skill'))(`${kind}: %s`, variant => {
    const actual = run(true, kind, variant)
    expect(actual).toEqual(run(false, kind, variant))
    const unchanged = ['dry', 'late-dry', 'wrong-skill', 'wrong-owner', 'cancel'].includes(variant)
    expect(actual.first).toBe(variant === 'modifier' ? 1.75 : unchanged ? 1 : 1.5)
    expect(actual.final).toBe(variant === 'repeat' ? 1 : actual.first)
    expect(actual.opponent).toBe(1)
  })
  it(`${kind}: feeds the real shield through SkillPhase`, () => run(true, kind, 'real-skill'))
}
