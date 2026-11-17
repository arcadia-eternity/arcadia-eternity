import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSourceProject, openAuthorSession } from '../src/author-api.ts'
import { attack, prepareContentPack } from '../src/testing.ts'
import { EffectTrigger, setGlobalLogger } from '@arcadia-eternity/battle/engine'
import { parseNpmPackOutput } from '@arcadia-eternity/pack-loader/node'
setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
const exec = promisify(execFile)

test(
  'the standard pack test harness combines an installed official catalog with authored effects',
  { timeout: 60000 },
  async t => {
    const root = await mkdtemp(join(tmpdir(), 'arcadia-official-dependency-'))
    let prepared
    t.after(async () => {
      await prepared?.dispose()
      await rm(root, { recursive: true, force: true })
    })
    const cache = join(root, 'cache')
    const base = join(root, 'base')
    await mkdir(base)
    // The real base build supplies the closed artifact and data. This fixture has
    // no JS runtime imports: preparation must not need to execute its entry point.
    const { arcadia } = JSON.parse(await readFile(new URL('../../../packs/base/package.json', import.meta.url), 'utf8'))
    await mkdir(join(base, 'dist'))
    for (const file of [arcadia.catalog, arcadia.content, arcadia.presentation, arcadia.effectArtifact])
      await cp(new URL(`../../../packs/base/${file}`, import.meta.url), join(base, file))
    await writeFile(
      join(base, 'package.json'),
      JSON.stringify({
        name: '@arcadia-eternity/data-pack-base',
        version: '1.0.0',
        arcadiaEternityPack: 'pack.json',
        arcadia,
        type: 'module',
        main: 'index.js',
      }),
    )
    await writeFile(join(base, 'pack.json'), '{}')
    await writeFile(join(base, 'index.js'), "throw new Error('base code executed by host')")
    const packed = parseNpmPackOutput(
      (await exec('npm', ['pack', '--json', '--ignore-scripts', '--cache', cache], { cwd: base })).stdout,
    )[0]
    const project = join(root, 'project')
    await createSourceProject(project, 'official-dependent')
    const file = join(project, 'package.json')
    const manifest = JSON.parse(await readFile(file, 'utf8'))
    manifest.dependencies = { '@arcadia-eternity/data-pack-base': `file:${join(base, packed.filename)}` }
    await writeFile(file, JSON.stringify(manifest))
    await symlink(base, join(project, 'node_modules/@arcadia-eternity/data-pack-base'), 'junction')
    const session = await openAuthorSession(project, { watch: false })
    try {
      const choices = await session.dependencyReferences('zh-CN')
      assert.deepEqual(choices.diagnostics, [])
      const skill = choices.items.find(item => item.kind === 'skills' && item.id === 'skill_zhuangji')
      assert.equal(skill?.label, '撞击')
      assert.equal(skill.projectId, 'base')
      assert.ok(choices.items.some(item => item.kind === 'marks' && item.id.startsWith('mark_ability_')))
      const pet = (await session.workspace.snapshot()).records.find(
        row => row.kind === 'species' && row.record.id === 'pet',
      )
      pet.record.learnable_skills.push({
        skill_id: { $ref: { projectId: skill.projectId, kind: 'skill', id: skill.id } },
        level: 1,
        hidden: false,
      })
      const result = await session.workspace.saveChanges(
        { changes: [{ ...pet, kind: 'record', expectedVersion: pet.version }] },
        { fromForm: true },
      )
      assert.equal(result.complete, true)
    } finally {
      await session.close()
    }
    await exec(process.execPath, [fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'build'], { cwd: project })
    prepared = await prepareContentPack(project, { cache })
    assert.equal(prepared.environment.content.getSkill('skill_zhuangji').power, 35)
    assert.ok(
      prepared.environment.data.species
        .find(row => row.id === 'official-dependent:pet')
        .learnable_skills.some(item => item.skill_id === 'skill_zhuangji'),
    )
    assert.ok(prepared.environment.installation.members.some(pkg => pkg.name === '@arcadia-eternity/data-pack-base'))
    assert.equal(
      prepared.environment.presentation.find(pkg => pkg.namespace === '').manifest.locales['zh-CN'].skill.skill_zhuangji
        .name,
      '撞击',
    )
    const battle = await prepared.createBattle('installed-base')
    const speed = battle.playerB.activePet.stat.spe
    battle.applyEffects(attack(battle), EffectTrigger.OnHit)
    assert.equal(battle.playerB.activePet.stat.spe, speed - 25)
    assert.equal(prepared.contentFor(battle).getSkill('skill_zhuangji').power, 35)
  },
)
