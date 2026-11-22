import { it, expect, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  ProfileRepository,
  defaultData,
  migrateEmbeddedLibrary,
  expandTeam,
  type ProfileData,
} from '@arcadia-eternity/local-profile'
import { FileProfileStorage } from '@arcadia-eternity/local-profile/node'
import { prepareContent, prepareRun } from '../src/application/prepare'
import { prepareEnvironmentRules } from '@arcadia-eternity/content-sdk/environment-rules'
import { runBattle } from '../src/application/run'

it('uses the selected profile team without using the UID as a battle identity or changing storage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'profile-team-'))
  try {
    const fixture = JSON.parse(
      await readFile(resolve(import.meta.dirname, '../../battle/test/fixtures/official-switch.input.json'), 'utf8'),
    )
    const data = defaultData('本地昵称')
    data.library = migrateEmbeddedLibrary({
      storage: [],
      currentTeamIndex: 1,
      teams: fixture.teams.map((team: { name: string; team: ProfileData['library']['storage'] }, index: number) => ({
        name: team.name,
        ruleSetId: 'casual_standard_ruleset',
        pets: team.team.map((pet, p) => ({ ...pet, id: `${index}${p}`.padEnd(21, 'x') })),
      })),
    })
    const repo = new ProfileRepository(new FileProfileStorage(directory))
    await repo.create({ data })
    const before = await repo.rawData()
    const second = join(directory, 'opponent.json')
    await writeFile(second, JSON.stringify(fixture.teams[0]))
    const options = {
      useProfile: true,
      profileDir: directory,
      player2: second,
      seed: 'fixture-seed',
      maxTurns: 1,
      maxActions: 10,
      teamSelection: false,
    }
    const content = { getSpecies: vi.fn(), getSkill: vi.fn(), getMark: vi.fn() }
    const selected = await prepareRun(options, directory, content)
    expect(selected.teams[0].name).toBe('本地昵称')
    expect(selected.teams[0].id).not.toBe(data.profile.id)
    expect(selected.teams[0].team.map(p => p.species)).toEqual(expandTeam(data.library, 1).pets.map(p => p.species))
    expect(selected.seed).toBe(options.seed)
    expect((await prepareRun({ ...options, team: '1' }, directory, content)).teams[0].team.map(p => p.species)).toEqual(
      expandTeam(data.library, 0).pets.map(p => p.species),
    )
    await expect(prepareRun({ ...options, team: '0' }, directory, content)).rejects.toMatchObject({
      code: 'TEAM_INVALID',
    })
    await expect(prepareRun({ ...options, player1: second }, directory, content)).rejects.toMatchObject({
      code: 'ARGUMENT_INVALID',
    })
    expect(await repo.rawData()).toBe(before)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('restores an expanded build from backup and replays it under the captured 120 rules', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'profile-120-'))
  try {
    const loaded = await prepareContent('builtin:base', directory)
    const declaration = JSON.parse(
      await readFile(new URL(import.meta.resolve('@arcadia-eternity/environment-training-120/package.json')), 'utf8'),
    ).arcadiaEnvironment.rules
    const { rules } = prepareEnvironmentRules(declaration, loaded.data.ruleSets)
    const ivs = { hp: 120, atk: 120, def: 120, spa: 120, spd: 120, spe: 120 }
    const pet = {
      id: 'a'.repeat(21),
      name: '测试配法',
      species: 'pet_duomo',
      level: 100,
      ivs,
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      nature: 'base:nature-34',
      enhancement: 'base:evolve-1',
      skills: ['skill_chongfeng'],
    }
    const data = defaultData('测试训练师')
    data.library = migrateEmbeddedLibrary({
      storage: [],
      currentTeamIndex: 0,
      teams: [{ name: '跨环境测试', ruleSetId: 'casual_standard_ruleset', pets: [pet] }],
    })
    const original = new ProfileRepository(new FileProfileStorage(join(directory, 'original')))
    await original.create({ data })
    const restarted = new ProfileRepository(new FileProfileStorage(join(directory, 'original')))
    const recoveredDir = join(directory, 'recovered')
    const recovered = new ProfileRepository(new FileProfileStorage(recoveredDir))
    const plan = await recovered.inspectImport(JSON.stringify(await restarted.exportBackup()))
    await recovered.commitImport({ ...plan, decision: 'restore' })
    const before = await recovered.rawData()
    const opponent = join(directory, 'opponent.json')
    await writeFile(
      opponent,
      JSON.stringify({ name: '对手', team: [{ ...pet, nature: 'Hardy', enhancement: undefined }] }),
    )
    const spec = await prepareRun(
      {
        useProfile: true,
        profileDir: recoveredDir,
        player2: opponent,
        seed: 'profile-120-replay',
        maxTurns: 1,
        maxActions: 2,
        teamSelection: false,
      },
      directory,
      loaded.content,
    )
    expect(spec.teams[0].team[0]).toMatchObject({ ivs, enhancement: pet.enhancement, nature: pet.nature })
    const signal = new AbortController().signal
    await expect(runBattle(loaded.content, { ...spec, rules: loaded.rules }, { signal })).rejects.toThrow(
      'ENVIRONMENT_TEAM_REJECTED',
    )
    const expanded = { ...spec, rules }
    const played = await runBattle(loaded.content, expanded, { signal, captureReplay: true })
    expect(played.initial).toBeDefined()
    expect(played.inputs.length).toBeGreaterThan(0)
    const replayed = await runBattle(loaded.content, expanded, {
      signal,
      replay: { initial: played.initial!, inputs: played.inputs },
    })
    expect(replayed.result).toEqual(played.result)
    expect(await recovered.rawData()).toBe(before)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)
