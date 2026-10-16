import {
  createBattle,
  replayBattle,
  restoreBattle,
  type BattleContent,
  type ReplayFixture,
} from '@arcadia-eternity/battle/core'
import fixture from './fixtures/official-switch.replay.json'
import { registry } from './trusted201.js'

/** Bundled unchanged for Browser and Node: no fs, DOM, timers, network or service. */
export function verifyCore() {
  const { content, replay } = fixture as unknown as { content: BattleContent; replay: ReplayFixture }
  const battle = replayBattle(replay, content, registry)
  const restored = restoreBattle(JSON.parse(JSON.stringify(battle.snapshot())), content, registry)
  const fresh = createBattle(replay.initial, content, registry)
  fresh.start()
  return {
    turn: restored.turn,
    victor: restored.victor,
    events: restored.getEvents().length,
    identical: JSON.stringify(restored.snapshot()) === JSON.stringify(battle.snapshot()),
    initialActions: fresh.getAvailableActions(fresh.playerA.id).length,
  }
}
