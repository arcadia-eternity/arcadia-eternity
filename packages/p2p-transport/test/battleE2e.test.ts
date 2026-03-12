import { describe, expect, test } from 'vitest'
import { Gender, Nature } from '@arcadia-eternity/const'
import { runInMemoryP2PBattleE2E } from '../node'

describe('runInMemoryP2PBattleE2E', () => {
  test('plays at least one real round over p2p transport', async () => {
    const result = await runInMemoryP2PBattleE2E({
      rounds: 2,
      playerATeam: {
        id: 'player_a',
        name: 'Player A',
        team: [
          {
            name: 'A_dilan',
            species: 'pet_dilan',
            level: 100,
            evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
            ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
            nature: Nature.Hardy,
            gender: Gender.Male,
            skills: ['skill_paida', 'skill_shuipao'],
            ability: 'mark_ability_zhongjie',
            emblem: 'mark_emblem_zhuiji',
            height: 50,
            weight: 10,
          },
        ],
      },
      playerBTeam: {
        id: 'player_b',
        name: 'Player B',
        team: [
          {
            name: 'B_dilan',
            species: 'pet_dilan',
            level: 100,
            evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
            ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
            nature: Nature.Hardy,
            gender: Gender.Male,
            skills: ['skill_paida', 'skill_shuipao'],
            ability: 'mark_ability_zhongjie',
            emblem: 'mark_emblem_zhuiji',
            height: 50,
            weight: 10,
          },
        ],
      },
    })

    expect(result.roundsPlayed).toBeGreaterThan(0)
    expect(result.finalState.currentTurn).toBeGreaterThanOrEqual(1)
    expect(result.hostEvents.length).toBeGreaterThan(0)
    expect(result.peerEvents.length).toBeGreaterThan(0)
  }, 15_000)

  test('still advances when peer skips action and turn timer auto-resolves', async () => {
    const result = await runInMemoryP2PBattleE2E({
      rounds: 1,
      peerActionMode: 'skip',
      battleConfig: {
        timerConfig: {
          enabled: true,
          turnTimeLimit: 1,
          totalTimeLimit: 30,
          animationPauseEnabled: true,
          maxAnimationDuration: 20_000,
        },
      },
      playerATeam: {
        id: 'player_a',
        name: 'Player A',
        team: [
          {
            name: 'A_dilan',
            species: 'pet_dilan',
            level: 100,
            evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
            ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
            nature: Nature.Hardy,
            gender: Gender.Male,
            skills: ['skill_paida', 'skill_shuipao'],
            ability: 'mark_ability_zhongjie',
            emblem: 'mark_emblem_zhuiji',
            height: 50,
            weight: 10,
          },
        ],
      },
      playerBTeam: {
        id: 'player_b',
        name: 'Player B',
        team: [
          {
            name: 'B_dilan',
            species: 'pet_dilan',
            level: 100,
            evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
            ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
            nature: Nature.Hardy,
            gender: Gender.Male,
            skills: ['skill_paida', 'skill_shuipao'],
            ability: 'mark_ability_zhongjie',
            emblem: 'mark_emblem_zhuiji',
            height: 50,
            weight: 10,
          },
        ],
      },
    })

    expect(result.roundsPlayed).toBe(1)
    expect(result.finalState.currentTurn).toBeGreaterThanOrEqual(1)
    expect(result.hostEvents.length).toBeGreaterThan(0)
    expect(result.peerEvents.length).toBeGreaterThan(0)
  }, 20_000)

  test('ends battle when peer skips action and total timer is exhausted', async () => {
    const result = await runInMemoryP2PBattleE2E({
      rounds: 1,
      peerActionMode: 'skip',
      battleConfig: {
        timerConfig: {
          enabled: true,
          turnTimeLimit: 30,
          totalTimeLimit: 1,
          animationPauseEnabled: true,
          maxAnimationDuration: 20_000,
        },
      },
      playerATeam: {
        id: 'player_a',
        name: 'Player A',
        team: [
          {
            name: 'A_dilan',
            species: 'pet_dilan',
            level: 100,
            evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
            ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
            nature: Nature.Hardy,
            gender: Gender.Male,
            skills: ['skill_paida', 'skill_shuipao'],
            ability: 'mark_ability_zhongjie',
            emblem: 'mark_emblem_zhuiji',
            height: 50,
            weight: 10,
          },
        ],
      },
      playerBTeam: {
        id: 'player_b',
        name: 'Player B',
        team: [
          {
            name: 'B_dilan',
            species: 'pet_dilan',
            level: 100,
            evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
            ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
            nature: Nature.Hardy,
            gender: Gender.Male,
            skills: ['skill_paida', 'skill_shuipao'],
            ability: 'mark_ability_zhongjie',
            emblem: 'mark_emblem_zhuiji',
            height: 50,
            weight: 10,
          },
        ],
      },
    })

    expect(result.finalState.status).toBe('Ended')
  }, 20_000)
})
