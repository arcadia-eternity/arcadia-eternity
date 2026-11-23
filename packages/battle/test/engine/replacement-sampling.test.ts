import { expect, it } from 'vitest'
import {
  AttackTargetOpinion,
  DamageContext,
  DamageType,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  defineNativeEffect,
  type effectId,
} from '@arcadia-eternity/battle/engine'
import { makeScenario } from './scenario'

it.each([EffectTrigger.OnDamageReplacement, EffectTrigger.Shield] as const)(
  'reuses %s samples while checking the new target and isolating predicates',
  async trigger => {
    const { battle, a, b } = makeScenario(73)
    try {
      for (const pet of [...a.team, ...b.team]) {
        pet.marks.splice(0)
        for (const skill of pet.skills) skill.effects.splice(0)
      }
      const caster = a.activePet
      const target = b.activePet
      const skill = caster.skills[0]
      const checks: Array<{ target: string; draw: number }> = []
      const proposals: number[] = []
      skill.effects.push(
        defineNativeEffect({
          id: 'sampling/redirect' as effectId,
          triggers: [trigger],
          when: ({ parent }) => parent.target === target,
          apply({ parent }) {
            parent.addRule({ id: 'redirect', priority: 5, change: { kind: 'redirect', target: caster } })
          },
        }),
        defineNativeEffect({
          id: 'sampling/prevention' as effectId,
          triggers: [trigger],
          when: ({ parent }) => {
            checks.push({ target: parent.target.id, draw: battle.random() })
            parent.addRule({ id: 'leaked-from-condition', priority: 10, change: { kind: 'prevent' } })
            return true
          },
          apply({ parent }) {
            const amount = battle.randomInt(1, 9)
            proposals.push(amount)
            parent.addRule({ id: 'prevent', change: { kind: 'prevent', amount } })
          },
        }),
      )
      const use = new UseSkillContext(new TurnContext(battle), a, caster, AttackTargetOpinion.opponent, skill)
      const damage = new DamageContext(use, skill, target, 20, DamageType.Physical)
      target.damage(damage)
      expect(checks.map(check => check.target)).toContain(target.id)
      expect(checks.map(check => check.target)).toContain(caster.id)
      expect(new Set(checks.map(check => check.draw)).size).toBe(1)
      expect(proposals.length).toBeGreaterThanOrEqual(2)
      expect(new Set(proposals).size).toBe(1)
      expect(damage.result).toMatchObject({ targetId: caster.id, hpLoss: 20 - proposals[0] })
    } finally {
      await battle.cleanup()
    }
  },
)
