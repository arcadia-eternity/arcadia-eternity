import {
  AttackTargetOpinion,
  BaseMark,
  BattleMessageType,
  EffectTrigger,
  SkillPhase,
  TurnContext,
  UseSkillContext,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { makeScenario } from './scenario'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
it('dispatches skill completion after mark cleanup and before the completion message', () => {
  const { battle, a, b, debuff } = makeScenario(720)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const stale = new BaseMark('fixture/stale' as baseMarkId, [], debuff.config).createInstance()
  stale.setOwner(a.activePet, battle.emitter)
  stale.isActive = false
  a.activePet.marks.push(stale)
  const order: string[] = []
  const skill = a.activePet.skills[0]
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/completion-order' as effectId,
      triggers: [EffectTrigger.SkillUseEnd],
      apply(ctx) {
        expect(ctx.parent).toBe(use)
        expect(a.activePet.marks).not.toContain(stale)
        order.push('effect')
      },
    }),
  )
  battle.registerListener(message => {
    if (message.type === BattleMessageType.SkillUseEnd) order.push('message')
  })
  const use = new UseSkillContext(new TurnContext(battle), a, a.activePet, AttackTargetOpinion.opponent, skill)
  use.hitOverrides.push({ willHit: false, priority: 1000 })
  a.currentRage = a.maxRage
  const phase = new SkillPhase(battle, a, a.activePet, AttackTargetOpinion.opponent, skill, use.parent, use)
  battle.phaseManager.registerPhase(phase)
  battle.phaseManager.executePhase(phase.id)
  expect(order).toEqual(['effect', 'message'])
})
