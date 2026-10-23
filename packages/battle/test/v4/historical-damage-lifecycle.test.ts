import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  BaseMark,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  DamageContext,
  RageContext,
  SkillPhase,
  Category,
  DamageType,
  BattleMessageType,
  AttackTargetOpinion,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
for (const kind of ['pet', 'skill', 'mark'] as const)
  for (const damageType of [DamageType.Physical, DamageType.Special, DamageType.Effect])
    for (const variant of ['normal', 'critical', 'cancel', 'ignore-shield'] as const)
      it(`historical damage dispatch ${kind} ${damageType} ${variant}`, () => {
        const { battle, a, b, debuff } = makeScenario(771)
        battles.push(battle)
        for (const pet of [...a.team, ...b.team]) {
          pet.marks.splice(0)
          for (const skill of pet.skills) skill.effects.splice(0)
        }
        const mark = new BaseMark('fixture/damage-source' as baseMarkId, [], debuff.config).createInstance()
        mark.setOwner(a.activePet, battle.emitter)
        a.activePet.marks.push(mark)
        const source = kind === 'pet' ? a.activePet : kind === 'skill' ? a.activePet.skills[0] : mark
        const use = new UseSkillContext(
          new TurnContext(battle),
          a,
          a.activePet,
          AttackTargetOpinion.opponent,
          a.activePet.skills[0],
        )
        const context = new DamageContext(
          use,
          source,
          b.activePet,
          20,
          damageType,
          variant === 'critical',
          1,
          variant === 'ignore-shield',
        )
        const trace: string[] = []
        const hp = b.activePet.currentHp
        b.activePet.skills[0].effects.push(
          defineNativeEffect({
            id: 'fixture/damage-lifecycle-observer' as effectId,
            triggers: [
              EffectTrigger.OnBeforeCalculateDamage,
              EffectTrigger.Shield,
              EffectTrigger.OnDamage,
              EffectTrigger.PostDamage,
              EffectTrigger.OnCritPostDamage,
            ],
            apply: ctx => {
              expect(ctx.parent).toBe(context)
              trace.push(ctx.trigger)
              if (ctx.trigger === EffectTrigger.OnBeforeCalculateDamage && variant === 'cancel')
                ctx.parent.available = false
            },
          }),
        )
        battle.registerListener(message => {
          if (message.type === BattleMessageType.Damage || message.type === BattleMessageType.DamageFail) {
            expect(message.data.source).toBe(source.id)
            trace.push(message.type)
          }
        })
        b.activePet.damage(context)
        if (damageType === DamageType.Effect) {
          expect(trace).toEqual([EffectTrigger.OnDamage, BattleMessageType.Damage])
          expect(b.activePet.currentHp).toBe(hp - 20)
        } else if (variant === 'cancel') {
          expect(trace).toEqual([EffectTrigger.OnBeforeCalculateDamage, BattleMessageType.DamageFail])
          expect(b.activePet.currentHp).toBe(hp)
          expect(context.damageResult).toBe(0)
        } else {
          expect(trace).toEqual([
            EffectTrigger.OnBeforeCalculateDamage,
            ...(variant === 'ignore-shield' ? [] : [EffectTrigger.Shield]),
            EffectTrigger.OnDamage,
            BattleMessageType.Damage,
            EffectTrigger.PostDamage,
            ...(variant === 'critical' ? [EffectTrigger.OnCritPostDamage] : []),
          ])
          expect(b.activePet.currentHp).toBe(hp - 20)
        }
      })
for (const variant of ['normal', 'cancel', 'zero'] as const)
  it(`real skill damage source and rage: ${variant}`, () => {
    const { battle, a, b } = makeScenario(772)
    battles.push(battle)
    for (const pet of [...a.team, ...b.team]) {
      pet.marks.splice(0)
      for (const skill of pet.skills) skill.effects.splice(0)
    }
    const skill = a.activePet.skills[0],
      use = new UseSkillContext(new TurnContext(battle), a, a.activePet, AttackTargetOpinion.opponent, skill)
    use.category = Category.Physical
    use.hitOverrides.push({ willHit: true, priority: 1000 })
    a.currentRage = a.maxRage
    b.currentRage = 0
    const damages: DamageContext[] = [],
      rage: RageContext[] = []
    skill.effects.push(
      defineNativeEffect({
        id: 'fixture/real-damage-observer' as effectId,
        triggers: [EffectTrigger.OnBeforeCalculateDamage, EffectTrigger.BeforeRageGain],
        apply: ctx => {
          if (ctx.parent instanceof DamageContext) {
            damages.push(ctx.parent)
            if (variant === 'cancel') ctx.parent.available = false
            if (variant === 'zero') ctx.parent.baseDamage = 0
          }
          if (ctx.parent instanceof RageContext && ctx.parent.reason === 'damage') rage.push(ctx.parent)
        },
      }),
    )
    const phase = new SkillPhase(battle, a, a.activePet, AttackTargetOpinion.opponent, skill, use.parent, use)
    battle.phaseManager.registerPhase(phase)
    battle.phaseManager.executePhase(phase.id)
    expect(damages).toHaveLength(1)
    expect(damages[0].source).toBe(skill)
    expect(rage).toHaveLength(variant === 'cancel' ? 0 : 1)
    if (variant === 'zero') expect(rage[0].value).toBe(0)
  })
