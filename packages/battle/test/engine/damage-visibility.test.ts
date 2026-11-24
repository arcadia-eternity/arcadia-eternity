import { expect, it } from 'vitest'
import {
  dealDamage,
  AttackTargetOpinion,
  BattleMessageType,
  DamageContext,
  TurnContext,
  UseSkillContext,
  type BattleMessage,
} from '@arcadia-eternity/battle/engine'
import { makeScenario } from './scenario'

it('exposes the damage trace only to the host and full-information views', async () => {
  const { battle, a, b } = makeScenario(124)
  try {
    const views: BattleMessage[][] = [[], [], [], []]
    battle.registerListener(m => views[0].push(m), { showAll: true })
    battle.registerListener(m => views[1].push(m), { viewerId: a.id })
    battle.registerListener(m => views[2].push(m), { showHidden: false })
    b.registerListener(m => views[3].push(m))
    const source = a.activePet.skills[0]
    const skill = new UseSkillContext(new TurnContext(battle), a, a.activePet, AttackTargetOpinion.opponent, source)
    for (const cancelled of [false, true]) {
      const event = new DamageContext(skill, source, b.activePet, 1)
      event.available = !cancelled
      dealDamage(event)
    }
    for (const type of [BattleMessageType.Damage, BattleMessageType.DamageFail] as const) {
      expect(views[0].find(m => m.type === type)?.data).toHaveProperty('result.intent.origin')
      for (const view of views.slice(1)) {
        const event = view.find(m => m.type === type)
        expect(event).toBeDefined()
        expect(event?.data).not.toHaveProperty('result')
      }
    }
  } finally {
    await battle.cleanup()
  }
})
