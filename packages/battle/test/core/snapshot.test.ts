import { beforeAll, expect, it } from 'vitest'
import {
  createBattle,
  restoreBattle,
  EffectRegistry,
  type BattleContent,
  type BattleSnapshot,
} from '@arcadia-eternity/battle/core'
import { basicOptions, officialContent, registry, skillAction, runOfficial } from './official.js'
let content: BattleContent
beforeAll(async () => {
  content = await officialContent()
})
it('requires explicit seed and unique IDs, resolves all content and trusted references at construction', () => {
  expect(() => createBattle({ ...basicOptions(), seed: undefined as unknown as string }, content, registry)).toThrow(
    'seed',
  )
  const duplicate = basicOptions()
  duplicate.players[1].id = 'A'
  expect(() => createBattle(duplicate, content, registry)).toThrow('unique')
  expect(() => createBattle(basicOptions(), content, new EffectRegistry())).toThrow('Missing trusted effect')
  const bad = basicOptions()
  bad.players[0].team[0].species = 'missing'
  expect(() => createBattle(bad, content, registry)).toThrow('Unknown species')
})
it('rejects functions, cycles and host objects instead of silently serializing them', () => {
  const b = runOfficial(content)
  for (const invalid of [() => 1, new Date(), new Map(), new Set(), NaN, Infinity, 1n]) {
    const save = b.snapshot() as BattleSnapshot & { injected: unknown }
    save.injected = invalid
    expect(() => restoreBattle(save, content, registry)).toThrow()
  }
  const save = b.snapshot() as BattleSnapshot & { injected: unknown }
  save.injected = save
  expect(() => restoreBattle(save, content, registry)).toThrow('Cyclic')
})
it.each([
  [
    'version',
    (s: BattleSnapshot) => {
      s.version = 9 as 1
    },
  ],
  [
    'content',
    (s: BattleSnapshot) => {
      s.contentIdentity = 'different'
    },
  ],
  [
    'rage',
    (s: BattleSnapshot) => {
      s.state.players[0].currentRage = -1
    },
  ],
  [
    'HP',
    (s: BattleSnapshot) => {
      s.state.players[0].team[0].currentHp = NaN
    },
  ],
  [
    'owner',
    (s: BattleSnapshot) => {
      s.state.players[0].activePetId = 'B/lead'
    },
  ],
  [
    'skill',
    (s: BattleSnapshot) => {
      s.state.players[0].team[0].skills[0].baseId = 'missing'
    },
  ],
  [
    'event sequence',
    (s: BattleSnapshot) => {
      s.events[0].sequence++
    },
  ],
  [
    'action sequence',
    (s: BattleSnapshot) => {
      s.actions[0].sequence++
    },
  ],
  [
    'rng',
    (s: BattleSnapshot) => {
      s.rng.a = 0.5
    },
  ],
  [
    'stage',
    (s: BattleSnapshot) => {
      s.state.players[0].team[0].stages.atk = 7
    },
  ],
] as const)('rejects malformed snapshot %s', (_name, mutate) => {
  const save = runOfficial(content).snapshot()
  mutate(save)
  expect(() => restoreBattle(save, content, registry)).toThrow()
})
it('isolates returned snapshots and states from the battle', () => {
  const b = createBattle(basicOptions(), content, registry)
  b.start()
  const save = b.snapshot()
  const state = b.getState()
  save.state.players[0].currentRage = 0
  state.players[0].team[0].currentHp = 0
  expect(b.playerA.currentRage).toBe(20)
  expect(b.playerA.activePet.currentHp).toBe(100)
  const restored = restoreBattle(b.snapshot(), content, registry)
  restored.submitAction(skillAction(restored, 'A'))
  restored.submitAction(skillAction(restored, 'B'))
  expect(b.turn).toBe(0)
  expect(restored.turn).toBe(1)
})
it('requires the same content and registered effect versions when restoring', () => {
  const save = runOfficial(content).snapshot(),
    altered = JSON.parse(JSON.stringify(content)) as BattleContent
  altered.skills[0].power++
  expect(() => restoreBattle(save, altered, registry)).toThrow('identity')
  expect(() => restoreBattle(save, content)).toThrow('Missing trusted effect')
})
it('different seeds change the RNG continuation', () => {
  const options = basicOptions(),
    a = createBattle(options, content, registry)
  options.seed = 'another'
  const b = createBattle(options, content, registry)
  a.start()
  b.start()
  for (const battle of [a, b]) {
    battle.submitAction(skillAction(battle, 'A'))
    battle.submitAction(skillAction(battle, 'B'))
  }
  expect(a.snapshot().rng).not.toEqual(b.snapshot().rng)
})
