import { afterAll, beforeAll, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTeam } from '../src/io/files'
import { replay } from '../src/application/replay'

let directory: string
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'arcadia-cli-validation-'))
})
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

function team() {
  return {
    name: 'Custom team',
    team: [
      {
        name: 'Custom pet',
        species: 'custom:species',
        skills: [],
        level: 100,
        evs: { hp: 255, atk: 255, def: 0, spa: 0, spd: 0, spe: 0 },
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        nature: 'Hardy',
      },
    ],
  }
}

it('accepts native stable content IDs and generates missing runtime IDs during file validation', async () => {
  const file = join(directory, 'custom.json')
  await writeFile(file, JSON.stringify(team()))
  const parsed = await readTeam(file)
  expect(parsed.team[0].species).toBe('custom:species')
  expect(parsed.id).toMatch(/^[A-Za-z0-9_-]{21}$/)
  expect(parsed.team[0].id).toMatch(/^[A-Za-z0-9_-]{21}$/)
})

it.each(['level', 'evs'] as const)('rejects invalid native %s before battle allocation', async field => {
  const input = team()
  if (field === 'level') input.team[0].level = 101
  else input.team[0].evs.def = 1
  const file = join(directory, `${field}.json`)
  await writeFile(file, JSON.stringify(input))
  await expect(readTeam(file)).rejects.toMatchObject({ code: 'TEAM_INVALID', exitCode: 2, source: file })

  // Invalid teams must fail before environment loading or native host construction.
  await expect(
    replay(
      {
        format: 'arcadia.cli.replay',
        version: 1,
        environment: { packs: [] },
        spec: { teams: [input, team()], seed: 'validation', teamSelection: false, maxTurns: 1, maxActions: 1 },
        initial: {},
        inputs: [],
        expected: { status: 'truncated' },
      },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'REPLAY_INVALID', exitCode: 3 })
})
