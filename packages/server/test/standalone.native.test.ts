import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { AttributeSystem, BattleStatus, setGlobalLogger } from '@arcadia-eternity/battle/v4'
import { LocalBattleSystemV4 } from '@arcadia-eternity/battle/v4/host'
import { PlayerSchema, parseWithErrors } from '@arcadia-eternity/schema'
import { createStandaloneBattle, getStandaloneRuntimeIdentity, validateStandaloneTeam } from '../src/standalone/native'
import input from '../../battle/src/v2/__tests__/fixtures/baseline/official-switch.input.json'

const systems: LocalBattleSystemV4[] = []
let baseline = 0
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
beforeEach(() => {
  baseline = AttributeSystem.getGlobalMemoryStats().totalInstances
})
afterEach(async () => {
  for (const system of systems.splice(0)) await system.cleanup()
  vi.restoreAllMocks()
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
})

function fixture() {
  // The engine baseline deliberately uses arbitrary skills and HP. Online teams
  // use the same draft shape with species-valid skills and calculated HP.
  return input.teams.map((team, index) =>
    parseWithErrors(PlayerSchema, {
      ...team,
      id: String(index).repeat(21),
      team: team.team.map(pet => ({
        ...pet,
        species: 'pet_dilan',
        skills: ['skill_paida', 'skill_shuipao'],
        maxHp: undefined,
      })),
    }),
  )
}

it('reports the actual immutable official runtime identity', async () => {
  const identity = await getStandaloneRuntimeIdentity()
  expect(identity).toMatchObject({
    kind: 'native-v4',
    contentRevision: expect.stringMatching(/^arcadia\.native-content\/1:/),
  })
  expect(identity.coreBuildId).toMatch(/^[a-f0-9]{64}$/)
  expect(identity.registryBuildId).toMatch(/^[a-f0-9]{64}$/)
  identity.contentRevision = 'modified'
  expect((await getStandaloneRuntimeIdentity()).contentRevision).not.toBe('modified')
})

it('validates official drafts repeatedly without allocating runtime instances or changing input', async () => {
  const team = fixture()[0].team
  const before = structuredClone(team)
  for (let index = 0; index < 3; index++) {
    expect(await validateStandaloneTeam(team)).toEqual(team)
    expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
  }
  expect(team).toEqual(before)
})

for (const invalid of ['empty', 'too-large', 'level', 'evs', 'species', 'skill', 'ability', 'emblem'] as const)
  it(`rejects an invalid draft before runtime allocation: ${invalid}`, async () => {
    const team = fixture()[0].team
    if (invalid === 'empty') team.splice(0)
    if (invalid === 'too-large') while (team.length <= 6) team.push(structuredClone(team[0]))
    if (invalid === 'level') team[0].level = 101
    if (invalid === 'evs') team[0].evs = { hp: 255, atk: 255, def: 1, spa: 0, spd: 0, spe: 0 }
    if (invalid === 'species') team[0].species = 'pet_unknown'
    if (invalid === 'skill') team[0].skills.push('skill_unknown')
    if (invalid === 'ability') team[0].ability = 'mark_unknown'
    if (invalid === 'emblem') team[0].emblem = 'mark_unknown'
    await expect(validateStandaloneTeam(team)).rejects.toThrow()
  })

for (const field of ['maxHp', 'currentHp', 'hp'])
  it(`rejects online ${field} overrides before schema cleaning and battle creation`, async () => {
    const players = fixture()
    Object.assign(players[0].team[0], { [field]: 999999 })
    await expect(validateStandaloneTeam(players[0].team)).rejects.toThrow(`cannot override ${field}`)
    await expect(createStandaloneBattle(players[0], players[1], {})).rejects.toThrow(`cannot override ${field}`)
  })

for (const invalid of ['foreign-skill', 'skill-level', 'foreign-ability', 'foreign-emblem'] as const)
  it(`rejects existing official content outside the species' allowed choices: ${invalid}`, async () => {
    const team = fixture()[0].team
    if (invalid === 'foreign-skill') team[0].skills = ['skill_qili']
    if (invalid === 'skill-level') team[0].level = 1
    if (invalid === 'foreign-ability') team[0].ability = 'mark_ability_yanhuo'
    if (invalid === 'foreign-emblem') team[0].emblem = 'mark_emblem_nuhuo'
    await expect(validateStandaloneTeam(team)).rejects.toThrow(/not learnable|not allowed/)
  })

it('accepts the species official ability and emblem', async () => {
  const team = fixture()[0].team
  team[0].ability = 'mark_ability_zhongjie'
  team[0].emblem = 'mark_emblem_zhuiji'
  expect(await validateStandaloneTeam(team)).toEqual(team)
})

it('creates an independent native battle without writing a runtime snapshot', async () => {
  const players = fixture()
  players[1].team[0].id = players[0].team[0].id
  const original = structuredClone(players)
  const snapshot = vi.spyOn(LocalBattleSystemV4.prototype, 'createRuntimeSnapshot')
  const system = await createStandaloneBattle(players[0], players[1], {
    rngSeed: input.seed,
    timerConfig: { enabled: false },
  })
  systems.push(system)
  expect(snapshot).not.toHaveBeenCalled()
  const state = await system.getState(undefined, true)
  expect(state.status).toBe(BattleStatus.Unstarted)
  expect(state.players.map(player => player.id)).toEqual(players.map(player => player.id))
  expect(new Set(state.players.flatMap(player => player.team?.map(pet => pet.id) ?? [])).size).toBe(4)
  expect(players).toEqual(original)
  await system.ready()
  expect(
    (await system.getAvailableSelection(players[0].id as Parameters<typeof system.getAvailableSelection>[0])).length,
  ).toBeGreaterThan(0)
  await system.submitAction({ type: 'surrender', player: state.players[0].id })
  await system.waitForCompletion()
  expect((await system.getState()).status).toBe(BattleStatus.Ended)
})

for (const invalid of ['same-player', 'schema', 'reference'] as const)
  it(`rejects invalid battle creation without retaining partial runtime objects: ${invalid}`, async () => {
    const players = fixture()
    if (invalid === 'same-player') players[1].id = players[0].id
    if (invalid === 'schema') players[1].team[0].level = 101
    if (invalid === 'reference') players[1].team[0].skills[0] = 'skill_unknown'
    await expect(createStandaloneBattle(players[0], players[1], {})).rejects.toThrow()
  })
