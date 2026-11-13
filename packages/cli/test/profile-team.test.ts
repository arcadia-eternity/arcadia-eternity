import { it, expect, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ProfileRepository, defaultData, type ProfileData } from '@arcadia-eternity/local-profile'
import { FileProfileStorage } from '@arcadia-eternity/local-profile/node'
import { prepareRun } from '../src/application/prepare'

it('uses the selected profile team without using the UID as a battle identity or changing storage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'profile-team-'))
  try {
    const fixture = JSON.parse(
      await readFile(resolve(import.meta.dirname, '../../battle/test/fixtures/official-switch.input.json'), 'utf8'),
    )
    const data = defaultData('本地昵称')
    data.library.teams = fixture.teams.map(
      (team: { name: string; team: ProfileData['library']['storage'] }, index: number) => ({
        name: team.name,
        ruleSetId: 'casual_standard_ruleset',
        pets: team.team.map((pet, p) => ({ ...pet, id: `${index}${p}`.padEnd(21, 'x') })),
      }),
    )
    data.library.currentTeamIndex = 1
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
    expect(selected.teams[0].team.map(p => p.species)).toEqual(data.library.teams[1].pets.map(p => p.species))
    expect(selected.seed).toBe(options.seed)
    expect((await prepareRun({ ...options, team: '1' }, directory, content)).teams[0].team.map(p => p.species)).toEqual(
      data.library.teams[0].pets.map(p => p.species),
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
