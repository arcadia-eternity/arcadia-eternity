import { beforeAll, describe, expect, it } from 'vitest'
import { createBattle, replayBattle, restoreBattle, type BattleContent } from '@arcadia-eternity/battle/core'
import { officialContent, officialOptions, registry, runOfficial, semanticState, officialAction } from './official.js'
import coreFixture from './fixtures/official-switch.replay.json'
import golden from '../../src/v2/__tests__/fixtures/baseline/official-switch.golden.json'

let content: BattleContent
beforeAll(async () => {
  content = await officialContent()
})
describe('V1 domain core / #201 official roster', () => {
  it('completes the #201 script with explicit V1 corrections and a complete native golden', () => {
    const battle = runOfficial(content)
    const expected = structuredClone(golden.final)
    // V1 context.ts applies the random damage factor once; V2 applied it twice.
    expected.players[0].pets[0].hp = 269
    expected.players[0].pets[1].hp = 259
    // V1 turn.ts only updates active pets' marks. Benched duration is paused.
    expected.players[0].pets[0].marks.unshift({ base: 'mark_hunzhuoshuiyu', stack: 1, duration: 3, active: true })
    expect(semanticState(battle)).toEqual(expected)
    expect(battle.exportReplay()).toEqual(coreFixture.replay)
    expect(
      battle
        .getEvents()
        .filter(e => e.type === 'damage')
        .map(e => e.data.damage),
    ).toEqual([27, 14, 20, 23, 20, 20, 18, 20])
    expect(runOfficial(content).snapshot()).toEqual(battle.snapshot())
    // Compare unchanged action/switch/defeat order to the original V2 golden; full native payloads are checked above.
    const aliases = new Map(
      battle.players.flatMap(p =>
        p.team.flatMap(pet => pet.skills.map(s => [s.id, `${pet.id}/${s.base.id}`] as const)),
      ),
    )
    const events = battle
      .getEvents()
      .filter(e =>
        ['skillUse', 'skillFail', 'skillUseEnd', 'switchIn', 'switchOut', 'petDefeated', 'battleEnd'].includes(e.type),
      )
      .map(e => ({
        turn: e.turn,
        type: e.type,
        data: Object.fromEntries(
          Object.entries(e.data).map(([k, v]) => [k, typeof v === 'string' ? (aliases.get(v) ?? v) : v]),
        ),
      }))
    expect(events).toEqual(
      golden.events.filter(e =>
        ['skillUse', 'skillFail', 'skillUseEnd', 'switchIn', 'switchOut', 'petDefeated', 'battleEnd'].includes(e.type),
      ),
    )
  })
  it('replays plain JSON and detects altered action and event ordering', () => {
    const battle = runOfficial(content)
    const fixture = JSON.parse(JSON.stringify(battle.exportReplay()))
    expect(replayBattle(fixture, content, registry).snapshot()).toEqual(battle.snapshot())
    ;[fixture.expectedEvents[0], fixture.expectedEvents[1]] = [fixture.expectedEvents[1], fixture.expectedEvents[0]]
    expect(() => replayBattle(fixture, content, registry)).toThrow('mismatch')
    const bad = battle.exportReplay()
    bad.actions[0].turn++
    expect(() => replayBattle(bad, content, registry)).toThrow('order')
  })
  it('restores after every submission and atomic phase, including a kill before turn-end', () => {
    const reference = runOfficial(content)
    let battle = createBattle(officialOptions(), content, registry)
    const indexes = { A: 0, B: 0 }
    battle.start()
    let restoredAfterKill = false
    for (let guard = 0; battle.status !== 'ended' && guard < 200; guard++) {
      const side = (['A', 'B'] as const).find(s => battle.getAvailableActions(s).length)
      if (side) expect(battle.submitAction(officialAction(battle, side, indexes[side]++), false).accepted).toBe(true)
      else expect(battle.advance()).toBe(true)
      if (battle.getState().lastKillerId) restoredAfterKill = true
      battle = restoreBattle(JSON.parse(JSON.stringify(battle.snapshot())), content, registry)
    }
    expect(restoredAfterKill).toBe(true)
    expect(battle.snapshot()).toEqual(reference.snapshot())
  })
})
