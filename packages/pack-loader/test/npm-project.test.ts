import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import {
  AttackTargetOpinion,
  BattleMessageType,
  EffectTrigger,
  Nature,
  TurnContext,
  UseSkillContext,
  RemoveMarkContext,
  createContentCatalog,
  parameterAddress,
  setGlobalLogger,
  type Battle,
} from '@arcadia-eternity/battle/v4'
import { inspectNpmProject } from '../src/npm/inspect'
import { prepareNpmProject, type NpmContentHost } from '../src/npm/prepare'
import { workRef } from '../src/works'

const exec = promisify(execFile)
vi.setConfig({ testTimeout: 30000 })
let root: string, environment: string
const battles: Battle[] = []
const environments: { dispose(): Promise<void> }[] = []
const host: NpmContentHost = {
  build: { formatVersion: 1, coreBuildId: 'a'.repeat(64), registryBuildId: 'b'.repeat(64) },
  base: { marks: [], skills: [], species: [] },
  templates: [],
  createContent: (data, revision, registrations) => createContentCatalog(data, revision, undefined, registrations),
}
const ref = (kind: 'skill' | 'mark' | 'behavior', id: string) => workRef('slow-pack', kind, id)
const data = {
  species: [
    {
      id: 'pet',
      num: 1,
      element: 'Normal',
      baseStats: { hp: 200, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
      genderRatio: null,
      heightRange: [1, 2],
      weightRange: [1, 2],
      ability: [],
      emblem: [],
      learnable_skills: ['strike', 'rest'].map(id => ({ skill_id: ref('skill', id), level: 1, hidden: false })),
    },
  ],
  skills: [
    {
      id: 'strike',
      element: 'Normal',
      category: 'Physical',
      power: 30,
      rage: 0,
      accuracy: 100,
      behaviors: [{ useId: 'slow', definitionId: ref('behavior', 'apply') }],
    },
    { id: 'rest', element: 'Normal', category: 'Physical', power: 1, rage: 0, accuracy: 100 },
  ],
  marks: [
    {
      id: 'slow',
      tags: ['status'],
      config: {
        duration: 2,
        persistent: false,
        maxStacks: 1,
        stackable: true,
        stackStrategy: 'refresh',
        keepOnSwitchOut: true,
      },
      behaviors: [{ useId: 'speed', definitionId: ref('behavior', 'penalty') }],
    },
  ],
  behaviors: [],
}
const effectModule = `
import { penalty } from 'arcadia-test-library'
process.env.ARCADIA_NPM_TEST_LOADED = 'yes'
export function createEffects({ sdk, marks, id }) {
  const { defineCodeEffect, targets, ops, conditions, EffectTrigger } = sdk
  const slow = marks.get(id('slow'))
  if (!slow) throw new Error('Missing slow mark')
  return [
    defineCodeEffect({ id: id('apply'), sourceKind: 'skill', build: ({ effectId }) => ({
      id: effectId, triggers: [EffectTrigger.OnHit], when: conditions.selfUsesSkill,
      apply: targets.opponentActive.apply(ops.addMark(slow)),
    }) }),
    defineCodeEffect({ id: id('penalty'), sourceKind: 'petMark', build: ({ effectId }) => {
      const amount = sdk.numberParam({ default: penalty, tags: ['slow:amount'] })
      return {
      id: effectId, triggers: [EffectTrigger.OnMarkCreated], rebindOnOwnerTransfer: true,
      parameters: { amount },
      apply: targets.ownerPet.apply(ops.bindAttribute({
        key: 'slow-speed', attribute: 'spe', operation: 'delta',
        value: amount.follow({ key: 'amount' }),
        lifetime: 'sourceMark', missing: 'detach',
      })),
    } } }),
  ]
}
`
async function pack(name: string, manifest: object, files: Record<string, string>) {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest))
  for (const [path, content] of Object.entries(files)) await writeFile(join(dir, path), content)
  const { stdout } = await exec('npm', ['pack', '--ignore-scripts', '--json'], { cwd: dir })
  return join(dir, JSON.parse(stdout)[0].filename)
}
beforeAll(async () => {
  setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
  root = await realpath(await mkdtemp(join(tmpdir(), 'arcadia-npm source-')))
  const library = await pack(
    'library',
    { name: 'arcadia-test-library', version: '1.0.0', type: 'module', exports: './index.js' },
    {
      'index.js': 'export const penalty = -25',
    },
  )
  const content = await pack(
    'content',
    {
      name: '@arcadia-test/slow',
      version: '1.0.0',
      type: 'module',
      files: ['content.json', 'effects.js', 'install.cjs'],
      dependencies: { 'arcadia-test-library': `file:${library}` },
      scripts: { install: 'node install.cjs' },
      arcadia: {
        formatVersion: 1,
        projectId: 'slow-pack',
        namespace: 'slow',
        content: 'content.json',
        effects: 'effects.js',
        sdkApi: 2,
        exports: [
          { id: 'apply', sourceKind: 'skill' },
          { id: 'penalty', sourceKind: 'petMark' },
        ],
      },
    },
    {
      'content.json': JSON.stringify({ data }),
      'effects.js': effectModule,
      'install.cjs': "require('node:fs').writeFileSync('lifecycle-ran', 'yes')",
    },
  )
  environment = join(root, 'environment')
  await mkdir(environment)
  await writeFile(
    join(environment, 'package.json'),
    JSON.stringify({
      private: true,
      name: 'test-environment',
      version: '1.0.0',
      dependencies: { '@arcadia-test/slow': `file:${content}` },
    }),
  )
  await exec('npm', ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], { cwd: environment })
}, 60000)
afterAll(async () => {
  for (const battle of battles) await battle.cleanup()
  for (const environment of environments) await environment.dispose()
  delete process.env.ARCADIA_NPM_TEST_LOADED
  if (root) await rm(root, { recursive: true, force: true })
})
async function prepare(dir = environment) {
  const installation = await inspectNpmProject(dir)
  const prepared = await prepareNpmProject(dir, host, {
    installationDigest: installation.digest,
    policy: { trust: 'local-development' },
  })
  environments.push(prepared)
  return prepared
}
function fixture(content: Awaited<ReturnType<typeof prepare>>['content']) {
  const [a, b] = content.parsePlayers(
    [0, 1].map(side => ({
      id: String(side).repeat(21),
      name: `Player ${side}`,
      team: [
        {
          id: String(side + 2).repeat(21),
          name: 'Pet',
          species: 'slow:pet',
          level: 100,
          nature: Nature.Hardy,
          skills: ['slow:strike', 'slow:rest'],
          evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
          ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        },
      ],
    })),
  )
  const battle = content.createBattle(a, b, { rngSeed: 'npm-sdk', timerConfig: { enabled: false } })
  battles.push(battle)
  const turn = () => new TurnContext(battle)
  const event = () => {
    const context = new UseSkillContext(turn(), a, a.activePet, AttackTargetOpinion.opponent, a.activePet.skills[0])
    context.updateActualTarget()
    return context
  }
  return { battle, a, b, turn, event }
}
it('installs standard tarballs without lifecycle execution and inspects without importing code', async () => {
  delete process.env.ARCADIA_NPM_TEST_LOADED
  const installation = await inspectNpmProject(environment)
  expect(installation.packages.map(pkg => pkg.name).sort()).toEqual(['@arcadia-test/slow', 'arcadia-test-library'])
  expect(installation.packages.every(pkg => pkg.integrity?.startsWith('sha512-'))).toBe(true)
  expect(process.env.ARCADIA_NPM_TEST_LOADED).toBeUndefined()
  await expect(readFile(join(environment, 'node_modules/@arcadia-test/slow/lifecycle-ran'))).rejects.toThrow()
  expect(installation.packages.every(pkg => !('filesDigest' in pkg))).toBe(true)
  expect(process.env.ARCADIA_NPM_TEST_LOADED).toBeUndefined()
})
it('captures local tarballs without changing source metadata or its lock audit identity', async () => {
  const files = ['package.json', 'package-lock.json', 'node_modules/.package-lock.json']
  const before = await Promise.all(files.map(file => readFile(join(environment, file), 'utf8')))
  const source = await inspectNpmProject(environment)
  const captured = await prepare()
  expect(captured.installation.digest).toBe(source.digest)
  expect(captured.installation.lockfileDigest).toBe(source.lockfileDigest)
  expect(await Promise.all(files.map(file => readFile(join(environment, file), 'utf8')))).toEqual(before)
})
it.each([
  { version: 2, shrinkwrap: false, reference: 'project-relative' },
  { version: 3, shrinkwrap: false, reference: 'project-relative' },
  { version: 3, shrinkwrap: true, reference: 'project-relative' },
  { version: 3, shrinkwrap: false, reference: 'home-relative' },
])(
  'captures relative root tarballs with lockfile v$version, shrinkwrap=$shrinkwrap and $reference',
  async ({ version, shrinkwrap, reference }) => {
    const directory = join(root, `relative-${version}-${shrinkwrap}-${reference}`)
    await cp(environment, directory, { recursive: true })
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    let artifact = manifest.dependencies['@arcadia-test/slow'].slice(5)
    const homeFixture = reference === 'home-relative' ? await mkdtemp(join(homedir(), '.arcadia-npm-test-')) : undefined
    try {
      if (homeFixture) {
        const target = join(homeFixture, 'slow.tgz')
        await cp(artifact, target)
        artifact = target
      }
      manifest.dependencies['@arcadia-test/slow'] =
        reference === 'home-relative'
          ? `file:~/${relative(homedir(), artifact).split(sep).join('/')}`
          : `file:${relative(directory, artifact).split(sep).join('/')}`
      await writeFile(join(directory, 'package.json'), JSON.stringify(manifest))
      await exec(
        'npm',
        [
          'install',
          '--package-lock-only',
          '--lockfile-version',
          String(version),
          '--ignore-scripts',
          '--offline',
          '--no-audit',
          '--no-fund',
        ],
        { cwd: directory },
      )
      if (shrinkwrap) await rename(join(directory, 'package-lock.json'), join(directory, 'npm-shrinkwrap.json'))
      const original = await inspectNpmProject(directory)
      const captured = await prepare(directory)
      expect(captured.installation.digest).toBe(original.digest)
      expect(captured.installation.lockfileDigest).toBe(original.lockfileDigest)
      expect(await readFile(join(directory, 'package.json'), 'utf8')).toBe(JSON.stringify(manifest))
    } finally {
      if (homeFixture) await rm(homeFixture, { recursive: true, force: true })
    }
  },
)
it('executes code effects in the real engine with refresh, removal, and independent battles', async () => {
  const { content } = await prepare()
  expect(process.env.ARCADIA_NPM_TEST_LOADED).toBe('yes')
  const f = fixture(content),
    other = fixture(content),
    speed = f.b.activePet.stat.spe
  f.battle.applyEffects(f.event(), EffectTrigger.OnMiss)
  expect(f.b.activePet.marks).toHaveLength(0)
  f.battle.applyEffects(f.event(), EffectTrigger.OnHit)
  const mark = f.b.activePet.marks[0]
  expect(mark.duration).toBe(2)
  expect(f.b.activePet.stat.spe).toBe(speed - 25)
  mark.duration = 1
  f.battle.applyEffects(f.event(), EffectTrigger.OnHit)
  expect(f.b.activePet.marks).toHaveLength(1)
  expect(mark.duration).toBe(2)
  expect(mark.stack).toBe(1)
  expect(f.b.activePet.stat.spe).toBe(speed - 25)
  expect(other.b.activePet.stat.spe).toBe(speed)
  f.battle.removeMark(new RemoveMarkContext(f.turn(), mark))
  expect(f.b.activePet.stat.spe).toBe(speed)
})
it('reproduces the same environment after npm ci in a different absolute directory', async () => {
  const fresh = join(root, 'fresh')
  await mkdir(fresh)
  for (const file of ['package.json', 'package-lock.json']) await cp(join(environment, file), join(fresh, file))
  await exec('npm', ['ci', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], { cwd: fresh })
  const a = await prepare(),
    b = await prepare(fresh)
  expect(b.revision).toBe(a.revision)
  expect(b.installation.digest).toBe(a.installation.digest)
}, 30000)
it('allows local code edits without renewed approval while preserving the existing catalog', async () => {
  const before = await prepare(),
    file = join(environment, 'node_modules/arcadia-test-library/index.js')
  const old = await readFile(file, 'utf8')
  try {
    await writeFile(file, 'export const penalty = -90')
    const next = await prepareNpmProject(environment, host, {
      installationDigest: 'old-file-digest-is-ignored',
      policy: { trust: 'local-development' },
    })
    environments.push(next)
    expect(next.installation.digest).toBe(before.installation.digest)
    const changed = fixture(next.content),
      changedSpeed = changed.b.activePet.stat.spe
    changed.battle.applyEffects(changed.event(), EffectTrigger.OnHit)
    expect(changed.b.activePet.stat.spe).toBe(changedSpeed - 90)
    const f = fixture(before.content),
      speed = f.b.activePet.stat.spe
    f.battle.applyEffects(f.event(), EffectTrigger.OnHit)
    expect(f.b.activePet.stat.spe).toBe(speed - 25)
  } finally {
    await writeFile(file, old)
  }
})

it('restores runtime parameters and source bindings at an existing selection checkpoint, then expires naturally', async () => {
  const loaded = await prepare(),
    f = fixture(loaded.content),
    speed = f.b.activePet.stat.spe
  let selected: (() => void) | undefined
  const wait = (stage: string) =>
    new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Waiting for ${stage}`)), 3000)
      selected = () => {
        clearTimeout(timeout)
        resolve()
      }
    })
  f.battle.registerListener(message => {
    if (message.type === BattleMessageType.TurnAction) selected?.()
  })
  const cancelled = (error: unknown) => {
    if (!(error instanceof Error) || error.message !== 'Battle cancelled') throw error
  }
  const initial = wait('initial selection'),
    running = f.battle.startBattle().catch(cancelled)
  await initial
  f.battle.applyEffects(f.event(), EffectTrigger.OnHit)
  const source = f.b.activePet.marks[0],
    effect = source.effects[0]
  loaded.content
    .parametersFor(effect.id)!
    .set(f.battle.configSystem, parameterAddress(effect.id, 'parameters', 'amount'), -35, source)
  expect(f.b.activePet.stat.spe).toBe(speed - 35)
  const snapshot = JSON.parse(JSON.stringify(loaded.content.snapshot(f.battle)))
  await f.battle.cleanup()
  await running
  const restored = (await prepare()).content.restore(snapshot)
  battles.push(restored)
  expect(restored.playerB.activePet.stat.spe).toBe(speed - 35)
  expect(restored.playerB.activePet.marks[0].duration).toBe(2)
  restored.registerListener(message => {
    if (message.type === BattleMessageType.TurnAction) selected?.()
  })
  const resumed = restored.resumeBattle().catch(cancelled)
  await restored.waitForInputReady()
  for (const remaining of [1, 0]) {
    const next = wait(`remaining duration ${remaining}`)
    for (const player of [restored.playerA, restored.playerB])
      expect(
        restored.setSelection({
          type: 'use-skill',
          player: player.id,
          skill: player.activePet.skills[1].id,
          target: AttackTargetOpinion.opponent,
        }),
      ).toBe(true)
    await next
    expect(restored.playerB.activePet.marks[0]?.duration ?? 0).toBe(remaining)
  }
  expect(restored.playerB.activePet.stat.spe).toBe(speed)
  await restored.cleanup()
  await resumed
}, 15000)

it('rejects uninspected packages and lockfile drift before importing code', async () => {
  const extra = join(environment, 'node_modules/unlisted-library')
  await mkdir(extra)
  try {
    await writeFile(join(extra, 'package.json'), JSON.stringify({ name: 'unlisted-library', version: '1.0.0' }))
    await expect(inspectNpmProject(environment)).rejects.toThrow()
  } finally {
    await rm(extra, { recursive: true })
  }
  const file = join(environment, 'package-lock.json'),
    original = await readFile(file, 'utf8')
  try {
    const lock = JSON.parse(original)
    lock.packages[''].dependencies['@arcadia-test/slow'] = '^9.0.0'
    await writeFile(file, JSON.stringify(lock))
    await expect(inspectNpmProject(environment)).rejects.toThrow('dependencies differ')
  } finally {
    await writeFile(file, original)
  }
})

it('accepts npm-omitted optional dependencies and peers, but rejects a missing required dependency', async () => {
  const optional = await pack(
    'optional-platform',
    {
      name: 'arcadia-test-optional',
      version: '1.0.0',
      os: ['impossible-os'],
    },
    {},
  )
  const library = await pack(
    'optional-consumer',
    {
      name: 'arcadia-test-optional-consumer',
      version: '1.0.0',
      optionalDependencies: { 'arcadia-test-optional': `file:${optional}` },
      peerDependencies: { 'arcadia-test-optional-peer': '*' },
      peerDependenciesMeta: { 'arcadia-test-optional-peer': { optional: true } },
    },
    {},
  )
  const dir = join(root, 'optional-installation')
  await mkdir(dir)
  const manifest = JSON.parse(await readFile(join(environment, 'package.json'), 'utf8'))
  manifest.dependencies['arcadia-test-optional-consumer'] = `file:${library}`
  manifest.optionalDependencies = { 'arcadia-test-optional': `file:${optional}` }
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest))
  await exec('npm', ['install', '--ignore-scripts', '--omit=dev', '--offline', '--no-audit', '--no-fund'], { cwd: dir })
  const inspection = await inspectNpmProject(dir)
  expect(inspection.packages.some(pkg => pkg.name === 'arcadia-test-optional')).toBe(false)
  expect(inspection.packages.find(pkg => pkg.name === 'arcadia-test-optional-consumer')?.dependencies).toEqual({})
  expect((await prepare(dir)).content.getSkill('slow:strike' as never).power).toBe(30)
  await rm(join(dir, 'node_modules/arcadia-test-library'), { recursive: true })
  await expect(inspectNpmProject(dir)).rejects.toThrow('npm rejected')
})

it('allows nested versions of ordinary libraries but rejects duplicate content identities', async () => {
  const library = await pack(
    'library-v2',
    { name: 'arcadia-test-library', version: '2.0.0', type: 'module', exports: './index.js' },
    {
      'index.js': 'export const penalty = -40',
    },
  )
  const extra = await pack(
    'other-content',
    {
      name: '@arcadia-test/other',
      version: '1.0.0',
      type: 'module',
      dependencies: { 'arcadia-test-library': `file:${library}` },
      arcadia: { formatVersion: 1, projectId: 'other-pack', namespace: 'other', content: 'content.json' },
    },
    { 'content.json': JSON.stringify({ data: { species: [], skills: [], marks: [], behaviors: [] } }) },
  )
  const dir = join(root, 'multiple')
  await mkdir(dir)
  const manifest = JSON.parse(await readFile(join(environment, 'package.json'), 'utf8'))
  manifest.dependencies['@arcadia-test/other'] = `file:${extra}`
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest))
  await exec('npm', ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], { cwd: dir })
  const result = await inspectNpmProject(dir)
  expect(
    result.packages
      .filter(pkg => pkg.name === 'arcadia-test-library')
      .map(pkg => pkg.version)
      .sort(),
  ).toEqual(['1.0.0', '2.0.0'])
  expect((await prepare(dir)).content.getSkill('slow:strike' as never).power).toBe(30)
  const file = join(dir, 'node_modules/@arcadia-test/other/package.json'),
    original = await readFile(file, 'utf8')
  const other = JSON.parse(original)
  other.arcadia.projectId = 'slow-pack'
  await writeFile(file, JSON.stringify(other))
  await expect(inspectNpmProject(dir)).rejects.toThrow('Content identity slow-pack')
  other.arcadia.projectId = 'other-pack'
  other.arcadia.namespace = 'slow'
  await writeFile(file, JSON.stringify(other))
  await expect(inspectNpmProject(dir)).rejects.toThrow('Content identity slow')
}, 30000)

it('rejects incompatible SDKs, escaping paths, and undeclared code exports with diagnostics', async () => {
  const dir = join(root, 'invalid-module')
  await cp(environment, dir, { recursive: true })
  const file = join(dir, 'node_modules/@arcadia-test/slow/package.json'),
    original = await readFile(file, 'utf8')
  const manifest = JSON.parse(original)
  manifest.arcadia.sdkApi = 999
  await writeFile(file, JSON.stringify(manifest))
  await expect(inspectNpmProject(dir)).rejects.toThrow('Effect SDK API')
  manifest.arcadia.sdkApi = 2
  manifest.arcadia.content = '../content.json'
  await writeFile(file, JSON.stringify(manifest))
  await expect(inspectNpmProject(dir)).rejects.toThrow('package-relative')
  await writeFile(file, original)
  await writeFile(join(dir, 'node_modules/@arcadia-test/slow/effects.js'), 'export const createEffects = () => []')
  await expect(prepare(dir)).rejects.toThrow('Module exports differ')
})
