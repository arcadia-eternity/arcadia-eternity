import { beforeAll, expect, it } from 'vitest'
import {
  UseSkillContext,
  BattleMessageType,
  SkillPhase,
  TurnContext,
  PhaseState,
  setGlobalLogger,
} from '@arcadia-eternity/battle/engine'
import { makeScenario } from './scenario'
let actualRage = 0
let intendedRage = 0
// Retained from the original expected-failure case; now a normal regression test.
beforeAll(async () => {
  setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
  const { battle, a, b } = makeScenario()
  try {
    let damage = 0
    battle.registerListener(m => {
      if (m.type === BattleMessageType.Damage) damage += m.data.damage
    })
    const phase = new SkillPhase(
      new UseSkillContext(new TurnContext(battle), b, b.activePet, b.activePet.skills[0].target, b.activePet.skills[0]),
    )
    expect(battle.phaseManager.run(phase).success).toBe(true)
    expect(battle.phaseManager.getPhasesByState(PhaseState.Failed)).toHaveLength(0)
    expect(damage).toBeGreaterThan(0)
    const gained = Math.floor((damage * 49) / a.activePet.stat.maxHp)
    expect(gained).toBeGreaterThan(0)
    intendedRage = 20 + gained
    actualRage = a.currentRage
  } finally {
    await battle.cleanup()
  }
})
it('V1-BUG-01: damage rage should use the DamagePhase result, not the stale caller context', () => {
  expect(actualRage).toBe(intendedRage)
})
