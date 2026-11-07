import { expect } from 'vitest'
import {
  BattleMessageType,
  PhaseState,
  snapshotBattle,
  restoreBattle,
  type Battle,
  type BattleMessage,
  type SnapshotCatalog,
} from '@arcadia-eternity/battle/v4'

/** Exercise a candidate through selection, forced switching and an optional fresh-catalog restore. */
export async function playCandidateGame(options: {
  battle: Battle
  effectId: string
  checkpoint: boolean
  checkpointTurn?: 0 | 1
  catalog: (fresh: boolean) => SnapshotCatalog
  setup: () => void
}) {
  let battle = options.battle
  let applications = 0
  const trace: unknown[] = []
  const submit = (current: Battle, id: Battle['playerA']['id'], type: 'switch-pet' | 'use-skill' | 'do-nothing') => {
    const selection = current.getAvailableSelection(id).find(s => s.type === type)
    if (!selection || !current.setSelection(selection)) throw new Error('Candidate game selection rejected')
  }
  const observe = (current: Battle) =>
    current.registerListener(message => {
      if (message.type === BattleMessageType.EffectApply && message.data.effect === options.effectId) applications++
      if ([BattleMessageType.EffectApplyFail, BattleMessageType.Error].includes(message.type))
        throw new Error('Candidate game failed')
      trace.push(message.type)
      if (message.type === BattleMessageType.TurnEnd)
        trace.push({
          turn: current.currentTurn,
          hp: [...current.playerA.team, ...current.playerB.team].map(p => p.currentHp),
          rage: [current.playerA.currentRage, current.playerB.currentRage],
        })
      if (message.type === BattleMessageType.ForcedSwitch)
        for (const id of message.data.player) submit(current, id, 'switch-pet')
      if (message.type === BattleMessageType.FaintSwitch) submit(current, message.data.player, 'do-nothing')
    })
  const ready = (current: Battle, turn: number) =>
    new Promise<void>(resolve => {
      const listener = (message: BattleMessage) => {
        if (message.type === BattleMessageType.TurnAction && current.currentTurn === turn) {
          current.unregisterListener(listener)
          resolve()
        }
      }
      current.registerListener(listener)
    })
  const choose = (current: Battle) => {
    if (current.currentTurn > 12) throw new Error('Candidate game exceeded turn bound')
    for (const p of [current.playerA, current.playerB])
      submit(
        current,
        p.id,
        current.currentTurn === 1 && p === current.playerA && p.activePet === p.team[0] ? 'switch-pet' : 'use-skill',
      )
  }
  const cancelled = (error: Error) => {
    if (error.message !== 'Battle cancelled') throw error
  }
  observe(battle)
  const first = ready(battle, 0)
  let running = battle.startBattle().catch(cancelled)
  try {
    const reached = async (waiting: Promise<void>) =>
      Promise.race([
        waiting,
        running.then(() => {
          throw new Error('Battle ended before checkpoint boundary')
        }),
      ])
    await reached(first)
    options.setup()
    if (options.checkpointTurn !== 0) {
      const second = ready(battle, 1)
      choose(battle)
      await reached(second)
    }
    const applicationsAtBoundary = applications
    if (options.checkpoint) {
      const saved = JSON.parse(JSON.stringify(snapshotBattle(battle, options.catalog(false))))
      await battle.cleanup()
      await running
      battle = restoreBattle(saved, options.catalog(true))
      observe(battle)
    }
    battle.registerListener(m => {
      if (m.type === BattleMessageType.TurnAction) choose(battle)
    })
    if (options.checkpoint) running = battle.resumeBattle()
    choose(battle)
    await running
    expect(battle.phaseManager.getPhasesByState(PhaseState.Failed)).toEqual([])
    expect(battle.victor).toBeDefined()
    expect(applications).toBeGreaterThan(0)
    expect(applications - applicationsAtBoundary).toBeGreaterThan(0)
    return {
      trace,
      applications,
      applicationsAfterBoundary: applications - applicationsAtBoundary,
      winner: battle.victor?.id,
      turn: battle.currentTurn,
      hp: [...battle.playerA.team, ...battle.playerB.team].map(p => p.currentHp),
      nextRandom: battle.random(),
    }
  } finally {
    await battle.cleanup()
    await running
  }
}
