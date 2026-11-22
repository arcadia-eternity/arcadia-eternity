import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import { stageCatalogProject } from '@arcadia-eternity/pack-loader/node'
import { prepareContent } from '../src/application/prepare'
import { replay } from '../src/application/replay'
import { simulate } from '../src/application/simulate'
import type { RunSpec } from '../src/application/types'
import { registerCommands } from '../src/commands/register'

const client = vi.hoisted(() => ({ connect: vi.fn(), request: vi.fn() }))
vi.mock('@arcadia-eternity/content-sdk/desktop', () => ({ connectDesktopInstance: client.connect }))
let root: string, directory: string, contentRevision: string
const environmentId = 'tournament'
const draftRevision = 'a'.repeat(64)
const leaseId = 'fixture-lease'
const signal = new AbortController().signal

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'arcadia-cli-player-env-'))
  directory = await stageCatalogProject(
    root,
    dirname(fileURLToPath(import.meta.resolve('@arcadia-eternity/data-pack-base/package.json'))),
  )
  await writeFile(
    join(directory, 'arcadia-admission.json'),
    JSON.stringify({ format: 'arcadia.npm-admission', version: 2, profile: 'local-development' }),
  )
  contentRevision = (await prepareContent(undefined, root, { npmProject: directory })).revision
  await writeFile(
    join(directory, '.arcadia-prepared.json'),
    JSON.stringify({
      format: 'arcadia.environment-installation/1',
      installationId: environmentId,
      draftRevision,
      contentRevision,
      document: {
        schemaVersion: 2,
        id: environmentId,
        name: 'Tournament',
        packages: {},
        sources: [],
        requires: {},
        rules: { schemaVersion: 1 },
      },
    }),
  )
})
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})
beforeEach(() => {
  vi.resetAllMocks()
  client.connect.mockResolvedValue({ request: client.request })
  client.request.mockImplementation(async input =>
    input.operation === 'battle-environment-acquire'
      ? { directory, leaseId, environmentId, draftRevision, contentRevision }
      : { released: true },
  )
})

it('requires one explicit content source and binds --instance to --environment', async () => {
  const code = 'CONTENT_OPTIONS'
  for (const options of [{ works: 'a' }, { npmProject: 'b' }, { approval: 'c' }])
    await expect(prepareContent(undefined, root, { ...options, environment: environmentId })).rejects.toMatchObject({
      code,
    })
  await expect(prepareContent('builtin:workspace', root, { environment: environmentId })).rejects.toMatchObject({
    code,
  })
  await expect(prepareContent(undefined, root, { instance: 'id' })).rejects.toMatchObject({ code })
  expect(client.connect).not.toHaveBeenCalled()
})

it.each(['battle local', 'local', 'battle simulate'])(
  'recognizes player-library flags on %s before using team files',
  async command => {
    const program = new Command().exitOverride()
    registerCommands(program, { cwd: root, signal, stdout: async () => {}, stderr: async () => {} })
    await expect(
      program.parseAsync(
        [
          ...command.split(' '),
          '-1',
          'first',
          '-2',
          'second',
          '--environment',
          environmentId,
          '--pack-ref',
          'builtin:workspace',
        ],
        { from: 'user' },
      ),
    ).rejects.toMatchObject({ code: 'CONTENT_OPTIONS' })
    expect(client.connect).not.toHaveBeenCalled()
  },
)

it('releases an acquired snapshot when preparation finds a mismatched revision', async () => {
  client.request.mockResolvedValueOnce({ directory, leaseId, environmentId, draftRevision, contentRevision: 'wrong' })
  await expect(prepareContent(undefined, root, { environment: environmentId })).rejects.toMatchObject({
    code: 'ENVIRONMENT_REVISION_MISMATCH',
  })
  expect(client.request).toHaveBeenLastCalledWith(
    { operation: 'battle-environment-release', leaseId },
    { signal: expect.any(AbortSignal) },
  )
})

it('runs after releasing the snapshot and rejects a changed rules revision for the same content installation', async () => {
  const loaded = await prepareContent(undefined, root, { environment: environmentId, instance: 'player' }, signal)
  expect(client.connect).toHaveBeenCalledWith('player', { signal })
  expect(client.request).toHaveBeenLastCalledWith(
    { operation: 'battle-environment-release', leaseId },
    { signal: expect.any(AbortSignal) },
  )
  const fixture = JSON.parse(
    await readFile(new URL('../../battle/test/fixtures/official-switch.input.json', import.meta.url), 'utf8'),
  )
  const spec: RunSpec = {
    teams: fixture.teams,
    rules: loaded.rules,
    seed: 'cup',
    maxActions: 1,
    maxTurns: 1,
    teamSelection: false,
  }
  for (const player of spec.teams)
    for (const pet of player.team) pet.skills = [pet.species === 'pet_huanli' ? 'skill_zhuangji' : 'skill_paida']
  const result = await simulate(loaded, spec, 1, { signal, captureReplay: true })
  const saved = JSON.parse(JSON.stringify(result.replays[0]))
  expect(saved.environment.playerLibrary).toEqual({
    environmentId,
    draftRevision,
    gameplayRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
  })
  expect((await replay(saved, signal, loaded)).report.verified).toBe(true)
  await expect(replay(saved, signal)).rejects.toMatchObject({ code: 'REPLAY_ENVIRONMENT', exitCode: 3 })
  await expect(
    replay(saved, signal, { ...loaded, playerLibrary: { ...loaded.playerLibrary!, draftRevision: 'b'.repeat(64) } }),
  ).rejects.toMatchObject({ code: 'REPLAY_ENVIRONMENT', exitCode: 3 })
  saved.spec.rules = { schemaVersion: 1, bans: { species: ['pet_xiuxiu'] } }
  await expect(replay(saved, signal, loaded)).rejects.toMatchObject({ code: 'REPLAY_ENVIRONMENT', exitCode: 3 })
}, 30000)
