import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { AttributeSystem, BattleStatus, setGlobalLogger } from '@arcadia-eternity/battle/engine'
import type { BattleHost } from '@arcadia-eternity/battle/host'
import { WorkerBattleSystem } from '@arcadia-eternity/battle/sandbox'
import { PlayerSchema, parseWithErrors } from '@arcadia-eternity/schema'
import { createServerBattle, getServerRuntimeIdentity, validateServerTeam } from '../src/runtime/native'
import shipped from '../../../bin/shipped-environments.json'
import input from '../../battle/test/fixtures/official-switch.input.json'

const systems: BattleHost[] = []
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
  const identity = await getServerRuntimeIdentity()
  expect(identity).toMatchObject({
    kind: 'native-v4',
    contentRevision: expect.stringMatching(/^arcadia\.work-environment\/1:[a-f0-9]{64}$/),
  })
  expect(identity.coreBuildId).toMatch(/^[a-f0-9]{64}$/)
  expect(identity.registryBuildId).toMatch(/^[a-f0-9]{64}$/)
  identity.contentRevision = 'modified'
  expect((await getServerRuntimeIdentity()).contentRevision).not.toBe('modified')
})

it('validates official drafts repeatedly without allocating runtime instances or changing input', async () => {
  const team = fixture()[0].team
  const before = structuredClone(team)
  for (let index = 0; index < 3; index++) {
    expect(await validateServerTeam(team)).toEqual(team)
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
    await expect(validateServerTeam(team)).rejects.toThrow()
  })

for (const field of ['maxHp', 'currentHp', 'hp'])
  it(`rejects online ${field} overrides before schema cleaning and battle creation`, async () => {
    const players = fixture()
    Object.assign(players[0].team[0], { [field]: 999999 })
    await expect(validateServerTeam(players[0].team)).rejects.toThrow(`cannot override ${field}`)
    await expect(createServerBattle(players[0], players[1], {})).rejects.toThrow(`cannot override ${field}`)
  })

for (const invalid of ['foreign-skill', 'skill-level', 'foreign-ability', 'foreign-emblem'] as const)
  it(`rejects existing official content outside the species' allowed choices: ${invalid}`, async () => {
    const team = fixture()[0].team
    if (invalid === 'foreign-skill') team[0].skills = ['skill_qili']
    if (invalid === 'skill-level') team[0].level = 1
    if (invalid === 'foreign-ability') team[0].ability = 'mark_ability_yanhuo'
    if (invalid === 'foreign-emblem') team[0].emblem = 'mark_emblem_nuhuo'
    await expect(validateServerTeam(team)).rejects.toThrow(/不能学习|not allowed/)
  })

it('checks inherited skills and second-generation natures independently against the prepared catalog', async () => {
  const starter = fixture()[0].team[0]
  const pet = { ...starter, species: 'pet_duomo', skills: ['skill_chongfeng'], nature: 'base:nature-34' }
  const eligible = { schemaVersion: 2, mechanics: { secondGenerationNatures: 'species' } } as const
  await expect(validateServerTeam([pet], undefined, eligible)).resolves.toEqual([pet])
  await expect(validateServerTeam([pet])).resolves.toEqual([pet])
  await expect(validateServerTeam([pet], undefined, { schemaVersion: 1 })).rejects.toThrow('二代性格')
  const poolRules = { schemaVersion: 2, mechanics: { inheritance: { eligible: 'species' } } } as const
  const hatchling = {
    ...starter,
    species: 'pet_dongqigui',
    level: 1,
    inheritedSkill: 'skill_shenhuxi',
    skills: ['skill_shenhuxi'],
  }
  await expect(validateServerTeam([hatchling], undefined, poolRules)).resolves.toEqual([hatchling])
  await expect(validateServerTeam([{ ...hatchling, species: 'pet_duomo' }], undefined, poolRules)).rejects.toThrow(
    '遗传',
  )
  await expect(validateServerTeam([{ ...hatchling, species: 'pet_dilan' }], undefined, poolRules)).rejects.toThrow(
    '遗传',
  )
  const other = { ...starter, nature: pet.nature }
  await expect(validateServerTeam([other], undefined, eligible)).rejects.toThrow('二代性格')
  const everyone = { schemaVersion: 2, mechanics: { secondGenerationNatures: 'all' } } as const
  await expect(validateServerTeam([other], undefined, everyone)).resolves.toEqual([other])
  await expect(validateServerTeam([{ ...other, inheritedSkill: 'skill_paida' }], undefined, everyone)).rejects.toThrow(
    '遗传',
  )
  await expect(validateServerTeam([{ ...pet, nature: 'missing:nature' }], undefined, everyone)).rejects.toThrow(
    /nature/,
  )
})

it('allows each new breeding family to inherit from the other under the official base rules', async () => {
  const { readFile } = await import('node:fs/promises')
  const { prepareEnvironmentRules } = await import('@arcadia-eternity/content-sdk/environment-rules')
  const declaration = JSON.parse(
    await readFile(
      new URL(import.meta.resolve('@arcadia-eternity/data-pack-base/environment/base-rules.json')),
      'utf8',
    ),
  )
  expect(declaration).toEqual(shipped.environments.find(env => env.id === shipped.defaultEnvironment)?.rules)
  const { rules } = prepareEnvironmentRules(declaration)
  const starter = fixture()[0].team[0]
  for (const [species, inheritedSkill, ownDonorMove] of [
    ['pet_hema', 'skill_duzhenlianshe', 'skill_kusechouda'],
    ['pet_heyimi', 'skill_duzhenlianshe', 'skill_kusechouda'],
    ['pet_shifeng', 'skill_kusechouda', 'skill_duzhenlianshe'],
    ['pet_suijingfeng', 'skill_kusechouda', 'skill_duzhenlianshe'],
  ]) {
    const pet = { ...starter, species, level: 1, nature: 'base:nature-34', inheritedSkill, skills: [inheritedSkill] }
    await expect(validateServerTeam([pet], undefined, rules)).resolves.toEqual([pet])
    await expect(
      validateServerTeam([{ ...pet, inheritedSkill: ownDonorMove, skills: [ownDonorMove] }], undefined, rules),
    ).rejects.toThrow('遗传')
  }
})

it('applies the 120 test environment’s selected nature and stage to all six battle stats', async () => {
  const { readFile } = await import('node:fs/promises')
  const { prepareEnvironmentRules } = await import('@arcadia-eternity/content-sdk/environment-rules')
  const declaration = JSON.parse(
    await readFile(
      new URL(import.meta.resolve('@arcadia-eternity/data-pack-base/environment/test-120-rules.json')),
      'utf8',
    ),
  )
  expect(declaration).toEqual(shipped.environments.find(env => env.id === 'training-120')?.rules)
  const { rules } = prepareEnvironmentRules(declaration)
  expect(rules.mechanics?.secondGenerationNatures).toBe('species')
  const players = fixture()
  const lead = players[0].team[0]
  lead.level = 100
  lead.species = 'pet_duomo'
  lead.skills = ['skill_chongfeng']
  lead.nature = 'base:nature-34'
  lead.enhancement = 'base:evolve-1'
  lead.ivs = { hp: 120, atk: 120, def: 120, spa: 120, spd: 120, spe: 120 }
  await expect(validateServerTeam([lead])).rejects.toThrow('ENVIRONMENT_TEAM_REJECTED')
  // The stored 31-point build reaches the same six stats when the room captures its 120-point environment.
  lead.ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }
  lead.ivMax = { ...lead.ivs }
  const baseStats = { maxHp: 410, atk: 353 * 0.9, def: 367, spa: 381 * 0.9, spd: 367 * 1.1, spe: 331 * 1.1 }
  for (const mode of ['active', 'suppressed'] as const) {
    const stage = mode === 'active' ? 'base:evolve-1' : 'other:uninstalled'
    lead.enhancement = stage
    const policy = {
      ...rules,
      mechanics: { ...rules.mechanics, enhancement: { ...rules.mechanics?.enhancement, mode } },
    }
    const system = await createServerBattle(players[0], players[1], {}, undefined, undefined, undefined, policy)
    systems.push(system)
    const state = await system.getState(undefined, true)
    const actual = state.players[0].team![0]
    const bonus = mode === 'active' ? { maxHp: 30, atk: 10, def: 10, spa: 10, spd: 10, spe: 5 } : undefined
    for (const key of Object.keys(baseStats) as Array<keyof typeof baseStats>)
      expect(actual.stats?.[key], mode + ' ' + key).toBeCloseTo(baseStats[key] + (bonus?.[key] ?? 0))
    expect(actual.currentHp).toBe(actual.maxHp)
    expect(lead.enhancement).toBe(stage)
  }
}, 30000)

it('accepts the species official ability and emblem', async () => {
  const team = fixture()[0].team
  team[0].ability = 'mark_ability_zhongjie'
  team[0].emblem = 'mark_emblem_zhuiji'
  expect(await validateServerTeam(team)).toEqual(team)
})

// Official cold initialization has a 20s Worker deadline; the test also drives the battle to completion.
it('creates an independent Worker battle while preserving room identities', async () => {
  const players = fixture()
  players[1].team[0].id = players[0].team[0].id
  const original = structuredClone(players)
  const system = await createServerBattle(players[0], players[1], {
    rngSeed: input.seed,
    timerConfig: { enabled: false },
  })
  systems.push(system)
  expect(system).toBeInstanceOf(WorkerBattleSystem)
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
}, 30_000)

for (const invalid of ['same-player', 'schema', 'reference'] as const)
  it(`rejects invalid battle creation without retaining partial runtime objects: ${invalid}`, async () => {
    const players = fixture()
    if (invalid === 'same-player') players[1].id = players[0].id
    if (invalid === 'schema') players[1].team[0].level = 101
    if (invalid === 'reference') players[1].team[0].skills[0] = 'skill_unknown'
    await expect(createServerBattle(players[0], players[1], {})).rejects.toThrow()
  })

it('cancels battle creation before content or team preparation can allocate a host', async () => {
  const players = fixture()
  const before = new AbortController()
  before.abort(new Error('launch canceled'))
  await expect(createServerBattle(players[0], players[1], {}, undefined, undefined, before.signal)).rejects.toThrow(
    'launch canceled',
  )
  const during = new AbortController()
  const preparing = createServerBattle(players[0], players[1], {}, undefined, undefined, during.signal)
  during.abort(new Error('preparation canceled'))
  await expect(preparing).rejects.toThrow('preparation canceled')
})

it('applies environment clocks and selected roster sizes in the server worker', async () => {
  const [a, b] = fixture()
  const system = await createServerBattle(a, b, { timerConfig: { enabled: false } }, undefined, undefined, undefined, {
    schemaVersion: 2,
    mechanics: {
      timer: { enabled: true, turnTimeLimit: 17, totalTimeLimit: 0 },
      teamSelection: { enabled: true, maxTeamSize: 1, timeLimit: 0 },
    },
  })
  systems.push(system)
  expect(await system.getTimerConfig()).toMatchObject({ enabled: true, turnTimeLimit: 17, totalTimeLimit: 0 })
  await system.ready()
  const { players } = await system.getState(undefined, true)
  for (const player of players) {
    const choice = (await system.getAvailableSelection(player.id)).find(action => action.type === 'team-selection')
    expect(choice?.selectedPets).toHaveLength(1)
    await system.submitAction(choice!)
  }
  await system.waitForPendingDecision()
  expect((await system.getState(undefined, true)).players.map(player => player.team?.length)).toEqual([1, 1])
}, 30000)
