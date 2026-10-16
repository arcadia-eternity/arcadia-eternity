import { describe, expect, it } from 'vitest'
import { createBattle, replayBattle, restoreBattle } from './index.js'
import replayFixture from './fixtures/replay.json' with { type: 'json' }
import type { BattleContent, BattleReplay, CreateBattleOptions } from './index.js'

const content: BattleContent = {
  species: [
    { id: 'species-fast', name: '快攻型', maxHp: 70, attack: 15, defense: 4, speed: 20 },
    { id: 'species-bench', name: '替补型', maxHp: 100, attack: 12, defense: 8, speed: 8 },
  ],
  skills: [
    { id: 'skill-hit', name: '普通攻击', power: 20, accuracy: 1, rageCost: 0, target: 'opponent' },
    { id: 'skill-costly', name: '怒气攻击', power: 30, accuracy: 1, rageCost: 20, target: 'opponent' },
  ],
}

function setup(): CreateBattleOptions {
  return {
    id: 'battle-seed-7',
    seed: 7,
    content,
    players: [
      {
        id: 'player-a',
        name: '甲',
        team: [
          { id: 'a-fast', speciesId: 'species-fast', skillIds: ['skill-hit', 'skill-costly'] },
          { id: 'a-bench', speciesId: 'species-bench', skillIds: ['skill-hit'] },
        ],
      },
      {
        id: 'player-b',
        name: '乙',
        team: [
          { id: 'b-fast', speciesId: 'species-fast', skillIds: ['skill-hit'] },
          { id: 'b-bench', speciesId: 'species-bench', skillIds: ['skill-hit'] },
        ],
      },
    ],
  }
}

describe('Seir2 Battle Core', () => {
  it('runs a full battle with deterministic turns, event order, and an explicit result', () => {
    const options = setup()
    options.players[0].team = [options.players[0].team[0]]
    options.players[1].team = [options.players[1].team[0]]
    const battle = createBattle(options)
    battle.submitAction('player-a', { type: 'use-skill', skillId: 'skill-hit' })
    expect(battle.getState().turn).toBe(1)
    battle.submitAction('player-b', { type: 'use-skill', skillId: 'skill-hit' })
    expect(battle.getState().turn).toBe(2)
    battle.submitAction('player-a', { type: 'use-skill', skillId: 'skill-hit' })
    battle.submitAction('player-b', { type: 'use-skill', skillId: 'skill-hit' })
    battle.submitAction('player-a', { type: 'use-skill', skillId: 'skill-hit' })
    battle.submitAction('player-b', { type: 'use-skill', skillId: 'skill-hit' })
    const state = battle.getState()
    expect(state.phase).toEqual({ type: 'ended' })
    expect(state.winnerId).toBe('player-a')
    expect(state.events.map(event => event.sequence)).toEqual(state.events.map((_, index) => index))
    expect(state.events.at(-1)).toMatchObject({ type: 'battle-ended', winnerId: 'player-a' })
  })

  it('applies V1 switch rage rounding and resolves an attack against the new active pet', () => {
    const battle = createBattle(setup())
    const snapshot = battle.snapshot()
    snapshot.state.players[0].rage = 21
    const prepared = restoreBattle(snapshot)
    prepared.submitAction('player-a', { type: 'switch-pet', petId: 'a-bench' })
    prepared.submitAction('player-b', { type: 'use-skill', skillId: 'skill-hit' })
    const state = prepared.getState()
    expect(state.players[0].rage).toBe(31) // floor(21 * 0.8), followed by end-of-turn +15
    expect(state.players[0].activePetId).toBe('a-bench')
    expect(state.pets.find(pet => pet.id === 'a-fast')?.hp).toBe(70)
    expect(state.pets.find(pet => pet.id === 'a-bench')?.hp).toBe(73)
    expect(state.events).toContainEqual(expect.objectContaining({ type: 'pet-switched', rage: 16 }))
    expect(state.events).toContainEqual(expect.objectContaining({ type: 'damage', targetPetId: 'a-bench', amount: 27 }))
    expect(state.pets.every(pet => Array.isArray(pet.marks))).toBe(true)
  })

  it('enters a forced-switch phase after a faint and requires a living replacement', () => {
    const snapshot = createBattle(setup()).snapshot()
    snapshot.state.pets.find(pet => pet.id === 'b-fast')!.hp = 1
    const battle = restoreBattle(snapshot)
    battle.submitAction('player-a', { type: 'use-skill', skillId: 'skill-hit' })
    battle.submitAction('player-b', { type: 'use-skill', skillId: 'skill-hit' })
    expect(battle.getState().phase).toEqual({ type: 'forced-switch', playerIds: ['player-b'] })
    expect(() => battle.submitAction('player-b', { type: 'use-skill', skillId: 'skill-hit' })).toThrow('must switch')
    battle.submitAction('player-b', { type: 'switch-pet', petId: 'b-bench' })
    battle.submitAction('player-a', { type: 'use-skill', skillId: 'skill-hit' })
    expect(battle.getState().players.find(player => player.id === 'player-b')?.activePetId).toBe('b-bench')
  })

  it('serializes a mid-turn snapshot without functions and resumes the same event sequence', () => {
    const battle = createBattle(setup())
    battle.submitAction('player-a', { type: 'use-skill', skillId: 'skill-hit' })
    const json = JSON.stringify(battle.snapshot())
    expect(json).not.toContain('function')
    const restored = restoreBattle(JSON.parse(json) as ReturnType<typeof battle.snapshot>)
    expect(restored.getState().phase).toEqual({ type: 'selection' })
    restored.submitAction('player-b', { type: 'use-skill', skillId: 'skill-hit' })
    const uninterrupted = createBattle(setup())
    uninterrupted.submitAction('player-a', { type: 'use-skill', skillId: 'skill-hit' })
    uninterrupted.submitAction('player-b', { type: 'use-skill', skillId: 'skill-hit' })
    expect(restored.getState()).toEqual(uninterrupted.getState())
  })

  it('preserves stable Mark data across a serialized snapshot', () => {
    const snapshot = createBattle(setup()).snapshot()
    snapshot.state.pets[0].marks = [
      { id: 'mark-1', definitionId: 'mark-sample', ownerPetId: 'a-fast', stacks: 1, turnsRemaining: 5, active: true },
    ]
    const restored = restoreBattle(JSON.parse(JSON.stringify(snapshot)))
    expect(restored.getState().pets[0].marks).toEqual(snapshot.state.pets[0].marks)
  })

  it('creates a portable replay and verifies its complete event sequence', () => {
    const battle = createBattle(setup())
    battle.submitAction('player-a', { type: 'use-skill', skillId: 'skill-hit' })
    battle.submitAction('player-b', { type: 'use-skill', skillId: 'skill-hit' })
    battle.submitAction('player-a', { type: 'use-skill', skillId: 'skill-hit' })
    battle.submitAction('player-b', { type: 'use-skill', skillId: 'skill-hit' })
    const replay = JSON.parse(JSON.stringify(battle.createReplay()))
    const repeated = replayBattle(replay)
    expect(repeated.getState()).toEqual(battle.getState())
    replay.expectedEvents[1].type = 'turn-ended'
    expect(() => replayBattle(replay)).toThrow('Replay event sequence did not match')
  })

  it('replays the committed headless fixture with its expected event order', () => {
    const replay = replayBattle(replayFixture as BattleReplay)
    expect(replay.getState().phase).toEqual({ type: 'ended' })
    expect(replay.getState().winnerId).toBe('player-a')
    expect(replay.events).toEqual(replayFixture.expectedEvents)
  })

  it('notifies isolated event subscribers and lets them unsubscribe', () => {
    const battle = createBattle(setup())
    const seen: string[] = []
    const unsubscribe = battle.subscribe(event => seen.push(event.type))
    battle.submitAction('player-a', { type: 'use-skill', skillId: 'skill-hit' })
    unsubscribe()
    battle.submitAction('player-b', { type: 'use-skill', skillId: 'skill-hit' })
    expect(seen).toContain('action-submitted')
    expect(seen).not.toContain('turn-ended')
  })

  it('rejects executable content so snapshots stay portable data', () => {
    const invalid = { ...content, effect: () => undefined } as unknown as BattleContent
    expect(() => createBattle({ ...setup(), content: invalid })).toThrow('only JSON data')
  })
})
