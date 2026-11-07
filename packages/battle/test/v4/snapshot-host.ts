import {
  BattleMessageType,
  setGlobalLogger,
  snapshotBattle,
  restoreBattle,
  SnapshotCatalog,
  type Battle,
  type BattleMessage,
  type BattleSnapshot,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
export function catalogFor(fixture: ReturnType<typeof makeScenario>) {
  const catalog = new SnapshotCatalog('v1-host-fixture/1')
  for (const player of [fixture.a, fixture.b])
    for (const pet of player.team) {
      catalog.registerContent(`species:${pet.originalSpecies.id}`, pet.originalSpecies)
      for (const skill of pet.skills) {
        catalog.registerContent(`skill:${skill.baseId}`, skill.base)
        for (const effect of skill.effects) catalog.registerEffect(effect.id, effect)
      }
    }
  catalog.registerContent(`mark:${fixture.debuff.id}`, fixture.debuff)
  for (const effect of fixture.debuff.effects) catalog.registerEffect(effect.id, effect)
  return catalog
}
function nextPrompt(battle: Battle) {
  return new Promise<void>(resolve => {
    const listener = (m: BattleMessage) => {
      if (m.type === BattleMessageType.TurnAction) {
        battle.unregisterListener(listener)
        resolve()
      }
    }
    battle.registerListener(listener)
  })
}
function select(battle: Battle, side: 'A' | 'B') {
  const player = side === 'A' ? battle.playerA : battle.playerB
  const action = battle
    .getAvailableSelection(player.id)
    .find(s => (side === 'A' && battle.currentTurn === 1 ? s.type === 'switch-pet' : s.type === 'use-skill'))
  if (!action || !battle.setSelection(action)) throw new Error('Snapshot host action rejected')
}
export async function createCheckpointProbe(): Promise<BattleSnapshot> {
  const fixture = makeScenario(),
    { battle } = fixture
  const catalog = catalogFor(fixture)
  let ready = nextPrompt(battle)
  const running = battle.startBattle().catch(error => {
    if (!(error instanceof Error) || error.message !== 'Battle cancelled') throw error
  })
  try {
    await ready
    ready = nextPrompt(battle)
    select(battle, 'A')
    select(battle, 'B')
    await ready
    select(battle, 'A')
    return JSON.parse(JSON.stringify(snapshotBattle(battle, catalog))) as BattleSnapshot
  } finally {
    await battle.cleanup()
    await running
  }
}
export async function resumeCheckpointProbe(input: unknown) {
  setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
  const fixture = makeScenario(),
    catalog = catalogFor(fixture)
  // The content loader may use a fixture to construct content; no runtime survives into restore.
  await fixture.battle.cleanup()
  const battle = restoreBattle(input, catalog)
  const first = {
    turn: battle.currentTurn,
    partial: battle.playerA.selection?.type,
    marks: battle.playerB.activePet.marks.length,
    accuracy: battle.playerB.activePet.stat.accuracy,
  }
  const damage: number[] = [],
    errors: string[] = []
  battle.registerListener(m => {
    if (m.type === BattleMessageType.TurnAction) {
      select(battle, 'A')
      select(battle, 'B')
    }
    if (m.type === BattleMessageType.ForcedSwitch)
      for (const player of m.data.player)
        battle.setSelection(battle.getAvailableSelection(player).find(s => s.type === 'switch-pet')!)
    if (m.type === BattleMessageType.FaintSwitch)
      battle.setSelection(battle.getAvailableSelection(m.data.player).find(s => s.type === 'do-nothing')!)
    if (m.type === BattleMessageType.Damage) damage.push(m.data.damage)
    if (([BattleMessageType.Error, BattleMessageType.EffectApplyFail] as BattleMessageType[]).includes(m.type))
      errors.push(m.type)
  })
  try {
    const running = battle.resumeBattle()
    select(battle, 'B')
    await running
    if (errors.length || battle.currentTurn !== 4 || battle.victor !== battle.playerA)
      throw new Error('Snapshot host continuation failed')
    return {
      first,
      turn: battle.currentTurn,
      winner: battle.victor.id,
      damage,
      hp: [battle.playerA, battle.playerB].flatMap(p => p.team.map(pet => pet.currentHp)),
    }
  } finally {
    await battle.cleanup()
  }
}
