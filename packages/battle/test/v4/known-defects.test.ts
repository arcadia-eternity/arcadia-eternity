import { beforeAll, expect, it } from 'vitest'
import { BattleMessageType, SkillPhase, TurnContext, PhaseState, setGlobalLogger } from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
let actualRage = 0
let intendedRage = 0
// Setup assertions live outside test.fails: missing damage/phase errors must fail normally.
beforeAll(async () => {
  setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
  const { battle, a, b } = makeScenario()
  try {
    let damage = 0
    battle.registerListener(m => {
      if (m.type === BattleMessageType.Damage) damage += m.data.damage
    })
    const phase = new SkillPhase(
      battle,
      b,
      b.activePet,
      b.activePet.skills[0].target,
      b.activePet.skills[0],
      new TurnContext(battle),
    )
    battle.phaseManager.registerPhase(phase)
    expect(battle.phaseManager.executePhase(phase.id).success).toBe(true)
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
it.fails('V1-BUG-01: damage rage should use the DamagePhase result, not the stale caller context', () => {
  expect(actualRage).toBe(intendedRage)
})
