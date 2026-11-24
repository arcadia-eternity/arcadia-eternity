import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseNpmPackOutput } from '@arcadia-eternity/pack-loader/node'
import { ContentWorkspace } from '../../../content-dev/src/content-workspace.ts'
import { ContentLibrary } from '../content-library.ts'
import { LocalEnvironments } from '../local-environments.ts'
import { playerLibraryRequest } from '../player-library-bridge.ts'
import { startTestPlayerLibraryBridge } from './fixtures/player-library-bridge.ts'
import { runContentCommand } from '../content-projects.ts'

const exec = promisify(execFile)
const repository = fileURLToPath(new URL('../../../../', import.meta.url))

test(
  'an active sandbox battle keeps its original package while the consumer installs and applies a new release',
  { timeout: 120000, skip: process.env.ARCADIA_DESKTOP_REAL_HOST !== '1' },
  async t => {
    const { createSourceProject } = await import('@arcadia-eternity/content-sdk/workspace')
    const { createNodeBattleWorkerManager } = await import('@arcadia-eternity/battle/sandbox/node')
    const { createLocalContentSessions } = await import('../local-content-sessions.ts')
    const { emptyNpmContentHost, prepareNpmProject } = await import('@arcadia-eternity/pack-loader/node')
    const { environmentVersion, gameplayRevision, buildDisplayCatalog, buildDisplayLocales, mapPresentationResources } =
      await import('@arcadia-eternity/pack-loader/native')
    const { writeFile } = await import('node:fs/promises')
    const root = await mkdtemp(join(tmpdir(), 'arcadia-consumer-update-')),
      project = join(root, 'author')
    const runtime = {
      executable: process.execPath,
      cli: resolve(repository, 'dist/cli.js'),
      npmCacheDirectory: join(root, 'cache'),
    }
    const approvals = [],
      reviews = []
    const library = new ContentLibrary({
      root: join(root, 'consumer'),
      run: (args, signal) => runContentCommand(runtime, args, signal),
      host: { status: () => ({ status: 'idle' }), retainedProjectDirectories: async () => [] },
      reviewInstall: pkg => {
        reviews.push(pkg.version)
        return true
      },
      authorizeEnvironment: (_document, effects) => {
        approvals.push(effects.map(pkg => pkg.version))
        return true
      },
    })
    const name = '@arcadia-local/consumer-test'
    let selected = '0.1.0'
    const sessions = createLocalContentSessions({
      library: {
        acquireProject: async () => {
          const document = { id: 'local', name: 'Local', packages: { [name]: selected }, sources: [] }
          return { ...(await library.prepareEnvironmentProject(document, { offline: true })), document }
        },
      },
      load: async () => ({
        host: emptyNpmContentHost,
        prepareNpmProject,
        environmentVersion,
        gameplayRevision,
        buildDisplayCatalog,
        buildDisplayLocales,
        mapPresentationResources,
      }),
      assetUrl: (token, hash) => 'http://localhost/' + token + '/' + hash,
    })
    const workers = createNodeBattleWorkerManager()
    t.after(async () => {
      await workers.dispose()
      await sessions.close()
      await library.close()
      await rm(root, { recursive: true, force: true })
    })
    await createSourceProject(project, 'consumer-test')
    async function installRelease() {
      await exec(process.execPath, [join(repository, 'packages/content-dev/dist/cli.js'), 'pack', '--release'], {
        cwd: project,
      })
      await library.installFile(join(project, 'arcadia-local-consumer-test-' + selected + '.tgz'), true)
    }
    await installRelease()
    assert.deepEqual(approvals, [])
    const first = await sessions.prepare()
    const power = view => view.content.skills.find(skill => skill.id === 'consumer-test:strike').power
    assert.equal(power(first), 40)
    const battle = await workers.create({
      environment: first.environment,
      players: [0, 1].map(side => ({
        id: String(side).repeat(21),
        name: 'Player ' + side,
        team: [
          {
            id: String(side + 2).repeat(21),
            name: 'Pet',
            species: 'consumer-test:pet',
            level: 100,
            nature: 'Hardy',
            skills: ['consumer-test:strike'],
            evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
            ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
          },
        ],
      })),
      options: { timerConfig: { enabled: false } },
    })
    await battle.ready()
    const pending = await battle.waitForPendingDecision()
    const before = await battle.getState(undefined, true)
    selected = '0.2.0'
    const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
    manifest.version = selected
    await writeFile(join(project, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
    const skill = join(project, 'data/skills/strike.yaml')
    await writeFile(skill, (await readFile(skill, 'utf8')).replace('power: 40', 'power: 90'))
    await installRelease()
    assert.deepEqual(approvals, [['0.1.0']])
    const second = await sessions.prepare()
    assert.deepEqual(reviews, ['0.1.0', '0.2.0'])
    assert.deepEqual(approvals, [['0.1.0'], ['0.2.0']])
    assert.equal(power(second), 90)
    assert.notEqual(first.environment.revision, second.environment.revision)
    assert.deepEqual(await battle.getState(undefined, true), before)
    for (const actions of pending.selections)
      await battle.submitAction(actions.find(action => action.type === 'use-skill'))
    await battle.waitForPendingDecision()
    const after = await battle.getState(undefined, true)
    assert.ok(after.players[0].team[0].stats.spe < before.players[0].team[0].stats.spe)
    await battle.cleanup()
    await sessions.release(first.token)
    await sessions.release(second.token)
  },
)

test(
  'a portable recipe applies offline through the desktop owner and remains selectable after restart',
  { timeout: 120000, skip: process.env.ARCADIA_DESKTOP_REAL_HOST !== '1' },
  async t => {
    const { acquireAuthorEnvironment } = await import('@arcadia-eternity/content-sdk/management-workspace')
    const { validateWorkspaceProject } = await import('@arcadia-eternity/server')
    const root = await mkdtemp(join(tmpdir(), 'arcadia-desktop-recipe-'))
    const recipe = join(root, 'recipe')
    const candidates = join(recipe, 'candidates')
    await mkdir(candidates, { recursive: true })
    let owner
    let library: ContentLibrary | undefined = undefined
    t.after(async () => {
      await owner?.close()
      await library?.close()
      await rm(root, { recursive: true, force: true })
    })
    const pack = async (project, output) => {
      const packed = await exec(
        'npm',
        [
          'pack',
          '--ignore-scripts',
          '--json',
          '--offline',
          '--cache',
          join(root, 'pack-cache'),
          '--pack-destination',
          output,
        ],
        { cwd: project },
      )
      return join(output, parseNpmPackOutput(packed.stdout)[0].filename)
    }
    const name = '@arcadia-example/slow'
    const fixture = join(root, 'slow')
    await mkdir(fixture)
    for (const file of ['package.json', 'content.json', 'src']) {
      await cp(join(repository, 'examples/ugc/slow', file), join(fixture, file), { recursive: true })
    }
    const { buildEffects } = await import('@arcadia-eternity/content-sdk/build')
    await buildEffects(fixture)
    await rename(await pack(fixture, candidates), join(candidates, 'slow.tgz'))
    const declaration = {
      schemaVersion: 2,
      id: 'desktop-league',
      name: '桌面联赛',
      sources: [],
      rules: { schemaVersion: 1 },
      requires: {},
    }
    await writeFile(
      join(recipe, 'package.json'),
      JSON.stringify({
        name: '@fixture/desktop-league',
        version: '1.0.0',
        dependencies: { [name]: 'file:candidates/slow.tgz' },
        arcadiaEnvironment: declaration,
        scripts: { postinstall: 'exit 1' },
      }),
    )
    const archive = await pack(recipe, root)
    const approvals = []
    let allowEffects = false
    const runtime = {
      executable: process.execPath,
      cli: join(repository, 'dist/cli.js'),
      npmCacheDirectory: join(root, 'cli-cache'),
    }
    const openedLibrary = new ContentLibrary({
      root: join(root, 'library'),
      run: (args, signal) => runContentCommand(runtime, args, signal),
      host: { status: () => ({ status: 'idle' }), retainedProjectDirectories: async () => [] },
      authorizeEnvironment: (_document, effects) => {
        approvals.push(effects.map(pkg => pkg.name))
        return allowEffects
      },
    })
    library = openedLibrary
    const openOwner = () =>
      new LocalEnvironments({
        openWorkspace: () => ContentWorkspace.open(join(root, 'personal')),
        library: { prepareEnvironmentProject: openedLibrary.prepareEnvironmentProject.bind(openedLibrary) },
        acquireRecipe: acquireAuthorEnvironment,
        validate: validateWorkspaceProject,
      })
    owner = openOwner()
    async function complete(input, hostOptions) {
      const { operationId } = await owner.request(input, hostOptions)
      for (;;) {
        const job = (await owner.snapshot()).operations.find(job => job.id === operationId)
        if (!['queued', 'running'].includes(job.status)) return job
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }
    const blocked = await complete(
      { action: 'install-recipe', source: { kind: 'file' } },
      { chooseRecipeArchive: async () => archive },
    )
    assert.match(blocked.error?.message ?? '', /未授权/)
    assert.equal((await owner.snapshot()).environments.length, 0)
    allowEffects = true
    const installed = await complete({ action: 'retry', operationId: blocked.id })
    assert.equal(installed.status, 'succeeded', JSON.stringify(installed.error))
    assert.deepEqual(approvals, [[name], [name]])
    assert.equal(installed.result.environmentId, declaration.id)
    const selected = await complete({ action: 'select', environmentId: declaration.id })
    assert.equal(selected.status, 'succeeded', JSON.stringify(selected.error))

    const label = 'Isolated player'
    const target = { label, library, environments: owner }
    const directory = join(root, '.arcadia', 'player-libraries')
    const { desktopCommand } = await import('../../../content-dev/src/desktop-cli.ts')
    const options = { directory }
    let bridge
    try {
      bridge = await startTestPlayerLibraryBridge({ ...target, profile: root, home: root })
    } catch (error) {
      if (error.code !== 'EPERM' || error.syscall !== 'listen') throw error
      // Restricted runners can exercise the same CLI and owners without opening a socket.
      t.diagnostic('loopback unavailable; using the owner dispatch directly')
      const id = '1'.repeat(32)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await writeFile(
        join(directory, id + '.json'),
        JSON.stringify({
          protocol: 'arcadia.player-library/v1',
          id,
          label,
          pid: process.pid,
          port: 1,
          token: 'a'.repeat(64),
        }),
        { mode: 0o600, flag: 'wx' },
      )
      const dispatch = playerLibraryRequest({ ...target, id })
      options.transport = async (_instance, request) => ({ status: 200, payload: { result: await dispatch(request) } })
    }
    const secondId = 'desktop-cli-league'
    try {
      const { instances } = await desktopCommand(['instances'], options)
      assert.equal(instances.length, 1)
      const targetArgs = ['--instance', instances[0].id]
      const installedViaCli = await desktopCommand(
        ['environments', 'install', archive, '--id', secondId, ...targetArgs],
        options,
      )
      assert.deepEqual(installedViaCli, { kind: 'environment', id: secondId, name: declaration.name })
      const listed = await desktopCommand(['environments', 'list', ...targetArgs], options)
      assert.equal(listed.selectedEnvironmentId, declaration.id)
      assert.ok(listed.environments.some(entry => entry.id === secondId && !entry.selected))
      if (bridge) {
        const team = join(root, 'team.json')
        await writeFile(
          team,
          JSON.stringify({
            name: 'Trainer',
            team: [
              {
                name: 'Slow',
                species: 'example-slow:pet',
                level: 100,
                nature: 'Hardy',
                evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
                ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
                skills: ['example-slow:strike'],
              },
            ],
          }),
        )
        const battle = (...args) =>
          exec(process.execPath, [runtime.cli, 'battle', ...args, ...targetArgs, '--json'], {
            cwd: root,
            env: { ...process.env, HOME: root, USERPROFILE: root },
            timeout: 30000,
          })
        const replay = join(root, 'battle.replay.json')
        const result = await battle(
          'simulate',
          '-1',
          team,
          '-2',
          team,
          '--environment',
          secondId,
          '--seed',
          'league',
          '--replay-out',
          replay,
        )
        const report = JSON.parse(result.stdout)
        assert.equal(report.counts.completed, 1)
        assert.equal(report.playerLibrary.environmentId, secondId)
        const verified = await battle('replay', replay, '--verify', '--environment', secondId)
        assert.equal(JSON.parse(verified.stdout).verified, true)
        await assert.rejects(battle('replay', replay, '--verify', '--environment', declaration.id), { code: 3 })
        assert.equal((await owner.snapshot()).selectedEnvironmentId, declaration.id)
      }
    } finally {
      await bridge?.close()
    }
    await owner.close()
    await rm(recipe, { recursive: true })
    await rm(archive)
    owner = openOwner()
    const snapshot = await owner.snapshot()
    assert.equal(snapshot.selectedEnvironmentId, declaration.id)
    assert.ok(snapshot.installations.some(entry => entry.environmentId === secondId && entry.status === 'ready'))
    assert.ok(snapshot.installations[0].contentCatalog.species.some(pet => pet.id === 'example-slow:pet'))
    const lease = await owner.acquireProject()
    try {
      const member = JSON.parse(await readFile(join(lease.directory, 'node_modules', name, 'package.json'), 'utf8'))
      assert.equal(member.name, name)
      assert.equal(lease.document.name, declaration.name)
    } finally {
      await lease.release()
    }
  },
)
