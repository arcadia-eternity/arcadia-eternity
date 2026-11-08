import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSourceProject } from '../src/author-api.mjs'
import { attack, prepareContentPack } from '../src/testing.mjs'
import { EffectTrigger, setGlobalLogger } from '@arcadia-eternity/battle/engine'
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
    await cp(new URL('../../../packs/base/assets/', import.meta.url), join(base, 'assets'), { recursive: true })
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
    const packed = JSON.parse(
      (await exec('npm', ['pack', '--json', '--ignore-scripts', '--cache', cache], { cwd: base })).stdout,
    )[0]
    const project = join(root, 'project')
    await createSourceProject(project, 'official-dependent')
    const file = join(project, 'package.json')
    const manifest = JSON.parse(await readFile(file, 'utf8'))
    manifest.dependencies = { '@arcadia-eternity/data-pack-base': `file:${join(base, packed.filename)}` }
    await writeFile(file, JSON.stringify(manifest))
    const species = join(project, 'data/species/pet.yaml')
    await writeFile(
      species,
      (await readFile(species, 'utf8')) + '\n  - skill_id: skill_zhuangji\n    level: 1\n    hidden: false\n',
    )
    await exec(process.execPath, [fileURLToPath(new URL('../src/cli.mjs', import.meta.url)), 'build'], { cwd: project })
    prepared = await prepareContentPack(project, { cache })
    assert.equal(prepared.environment.content.getSkill('skill_zhuangji').power, 35)
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
