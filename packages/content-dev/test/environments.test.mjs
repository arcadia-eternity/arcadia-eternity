import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSourceProject, openAuthorSession } from '../src/author-api.ts'
import { prepareContentPack, attack, runBattle } from '../src/testing.ts'
import {
  AttackTargetOpinion,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  setGlobalLogger,
} from '@arcadia-eternity/battle/engine'
setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
const exec = promisify(execFile)
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

test(
  'two actual npm packs interact through one locked environment without inventing formal dependencies',
  { timeout: 120000 },
  async t => {
    const root = await mkdtemp(join(tmpdir(), 'arcadia-environments-'))
    const a = join(root, 'a'),
      b = join(root, 'b')
    await createSourceProject(a, 'environment-a')
    await createSourceProject(b, 'environment-b')
    const session = await openAuthorSession(a, { watch: true, execute: true })
    let prepared, repeated
    t.after(async () => {
      await prepared?.dispose()
      await repeated?.dispose()
      await session.close()
      await rm(root, { recursive: true, force: true })
    })
    await exec(process.execPath, [cli, 'build'], { cwd: a })
    const env = {
      schemaVersion: 1,
      id: 'interaction',
      name: '双包减速交互',
      packages: {},
      sources: ['@arcadia-local/environment-b'],
    }
    await session.environments.save({ document: env, expectedVersion: null })
    await assert.rejects(prepareContentPack(a, { environmentId: env.id }), /ENVIRONMENT_SOURCE_MISSING/)
    const options = { environmentId: env.id, sources: { '@arcadia-local/environment-b': b }, lockRoot: a }
    prepared = await prepareContentPack(a, options)
    assert.equal(prepared.environment.installation.packages.filter(pkg => pkg.manifest).length, 2)
    assert.equal(JSON.parse(await readFile(join(a, 'package.json'), 'utf8')).dependencies, undefined)
    const players = prepared.defaultPlayers()
    players[1].team[0].species = 'environment-b:pet'
    players[1].team[0].skills = ['environment-b:strike', 'environment-b:rest']
    const battle = await prepared.createBattle('cross-pack-effects', { players })
    const speedA = battle.playerA.activePet.stat.spe,
      speedB = battle.playerB.activePet.stat.spe
    battle.applyEffects(attack(battle), EffectTrigger.OnHit)
    assert.equal(battle.playerB.activePet.marks[0].baseId, 'environment-a:slow')
    assert.equal(battle.playerB.activePet.stat.spe, speedB - 25)
    const context = new UseSkillContext(
      new TurnContext(battle),
      battle.playerB,
      battle.playerB.activePet,
      AttackTargetOpinion.opponent,
      battle.playerB.activePet.skills[0],
    )
    context.updateActualTarget()
    battle.applyEffects(context, EffectTrigger.OnHit)
    assert.equal(battle.playerA.activePet.stat.spe, speedA - 25)
    const first = await runBattle(await prepared.createBattle('integration-seed', { players }))
    const second = await runBattle(await prepared.createBattle('integration-seed', { players }))
    assert.deepEqual(first, second)
    const lock = await readFile(join(a, 'debug/environments/interaction.package-lock.json'), 'utf8')
    assert.ok(!lock.includes(root))
    assert.match(lock, /file:candidates\//)
    repeated = await prepareContentPack(a, options)
    assert.equal(repeated.environmentLock.version, prepared.environmentLock.version)
    assert.deepEqual(repeated.teamVersions, prepared.teamVersions)
    // The same environment can be launched through the actual captured-preview job.
    await mkdir(join(a, '.arcadia'), { recursive: true })
    await writeFile(join(a, '.arcadia/debug-sources.json'), JSON.stringify(options.sources))
    let job = await session.jobs.start({ kind: 'preview', environmentId: env.id })
    while (['queued', 'running'].includes(job.state)) {
      await new Promise(resolve => setTimeout(resolve, 50))
      job = session.jobs.get(job.jobId)
    }
    assert.equal(job.state, 'succeeded', JSON.stringify(job))
    await new Promise(resolve => setTimeout(resolve, 350))
    await session.jobs.refresh()
    assert.equal(session.jobs.get(job.jobId).stale, false)
    const team = (await session.teams.list())[0]
    const { version, ...document } = team
    await session.teams.save({
      document: { ...document, name: 'Changed team, same content' },
      expectedVersion: version,
    })
    await new Promise(resolve => setTimeout(resolve, 350))
    await session.jobs.refresh()
    assert.equal(session.jobs.get(job.jobId).stale, false, 'team files do not invalidate a content candidate')
    const otherSkill = join(b, 'data/skills/strike.yaml')
    const otherOriginal = await readFile(otherSkill, 'utf8')
    await writeFile(otherSkill, otherOriginal.replace('power: 40', 'power: 41'))
    await session.jobs.refresh()
    assert.equal(session.jobs.get(job.jobId).stale, true, 'collaborator edits invalidate the prepared environment')
    await writeFile(otherSkill, otherOriginal)
    await session.jobs.stopPreviews()
    // A's content refers to B's behavior without a formal npm dependency: co-installation cannot authorize it.
    const skill = join(a, 'data/skills/strike.yaml')
    const originalSkill = await readFile(skill, 'utf8')
    await writeFile(skill, originalSkill.replace('projectId: environment-a', 'projectId: environment-b'))
    await exec(process.execPath, [cli, 'build'], { cwd: a })
    await assert.rejects(prepareContentPack(a, options), /依赖|depend|reference|resolv|export/i)
    const manifestFile = join(a, 'package.json')
    const originalManifest = await readFile(manifestFile, 'utf8')
    const declared = JSON.parse(originalManifest)
    declared.dependencies = { '@arcadia-local/environment-b': '^0.1.0' }
    await writeFile(manifestFile, JSON.stringify(declared))
    const admitted = await prepareContentPack(a, options)
    try {
      assert.equal(admitted.environment.installation.packages.filter(pkg => pkg.manifest).length, 2)
    } finally {
      await admitted.dispose()
    }
    declared.dependencies['@arcadia-local/environment-b'] = '^99.0.0'
    await writeFile(manifestFile, JSON.stringify(declared))
    await assert.rejects(prepareContentPack(a, options))
    await writeFile(manifestFile, originalManifest)
    await writeFile(skill, originalSkill)
    await exec(process.execPath, [cli, 'build'], { cwd: a })
    // Missing references are also rejected at admission, rather than silently editing teams or dependencies.
    const invalid = structuredClone(players)
    invalid[0].team[0].species = 'missing:pet'
    await assert.rejects(prepared.createBattle('missing-content', { players: invalid }))
    // Duplicate namespace/project registrations fail explicitly through the existing npm inspector.
    const metadata = JSON.parse(await readFile(join(b, 'package.json'), 'utf8'))
    metadata.arcadia.namespace = 'environment-a'
    await writeFile(join(b, 'package.json'), JSON.stringify(metadata))
    await assert.rejects(prepareContentPack(a, options), /NAMESPACE_CONFLICT|identity/i)
  },
)
