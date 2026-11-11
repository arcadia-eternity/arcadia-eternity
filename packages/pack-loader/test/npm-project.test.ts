import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
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
  type ContentCatalog,
  parameterAddress,
  setGlobalLogger,
  type Battle,
} from '@arcadia-eternity/battle/engine'
import { prepareSandboxContent, ArenaEffectModule } from '@arcadia-eternity/battle/sandbox/effects'
import { inspectNpmProject } from '../src/npm/inspect'
import { parseNpmPackOutput } from '../src/npm/pack-output'
import { prepareNpmProject, type NpmContentHost } from '../src/npm/prepare'
import { workRef } from '../src/works'
import { createNodeBattleWorkerManager } from '@arcadia-eternity/battle/sandbox/node'

const exec = promisify(execFile)
vi.setConfig({ testTimeout: 30000 })
let root: string, environment: string
const battles: Battle[] = []
const environments: { dispose(): Promise<void> }[] = []
const host: NpmContentHost = {
  build: { formatVersion: 1, coreBuildId: 'a'.repeat(64), registryBuildId: 'b'.repeat(64) },
  base: { marks: [], skills: [], species: [] },
  templates: [],
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
if (typeof process !== 'undefined') throw Error('Node capability leaked into effect module')
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
  return join(dir, parseNpmPackOutput(stdout)[0].filename)
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
  const prepared = await prepareNpmProject(dir, host, {
    policy: { trust: 'local-development' },
  })
  environments.push(prepared)
  return prepared
}
it('prepares only immutable metadata and code artifacts without creating an Arena VM', async () => {
  const vm = vi.spyOn(ArenaEffectModule, 'prepare').mockRejectedValue(new Error('VM created during preparation'))
  try {
    const prepared = await prepare()
    expect(vm).not.toHaveBeenCalled()
    expect(prepared.content.getSkill('slow:strike').power).toBe(30)
    expect(prepared.content).not.toHaveProperty('parsePlayers')
    expect(prepared.content).not.toHaveProperty('createBattle')
    expect(Object.isFrozen(prepared.sandbox.modules[0].artifact)).toBe(true)
  } finally {
    vm.mockRestore()
  }
})
it.each([
  [
    'module initialization',
    "throw new Error('module-init-only-in-battle'); export function createEffects(){return []}",
    'module-init-only-in-battle',
  ],
  [
    'factory execution',
    "export function createEffects(){throw new Error('factory-only-in-battle')}",
    'factory-only-in-battle',
  ],
  ['missing export', 'export function createEffects(){return []}', 'unregistered native export'],
  [
    'source kind',
    effectModule.replace("id: id('apply'), sourceKind: 'skill'", "id: id('apply'), sourceKind: 'petMark'"),
    'source mismatch',
  ],
  ['duplicate export', effectModule.replace("id: id('penalty')", "id: id('apply')"), 'duplicated'],
])('delays dynamic code validation to the actual Worker: %s', async (_label, source, message) => {
  const dir = await mkdtemp(join(root, 'deferred-code-'))
  await cp(environment, dir, { recursive: true })
  await writeFile(join(dir, 'node_modules/@arcadia-test/slow/effects.js'), source)
  const prepared = await prepare(dir)
  const workers = createNodeBattleWorkerManager()
  try {
    // Dynamic checks run before player allocation, after entering the dedicated Worker.
    await expect(workers.create({ environment: prepared.sandbox, players: [{}, {}] })).rejects.toThrow(message)
    expect(
      workers.status().every(entry => !['preparing', 'active'].includes(entry.state) && entry.cleanup === 'terminated'),
    ).toBe(true)
  } finally {
    await workers.dispose()
  }
})
async function reference(prepared: Awaited<ReturnType<typeof prepare>>) {
  const effects = await prepareSandboxContent(prepared.sandbox)
  environments.push({
    async dispose() {
      effects.dispose()
    },
  })
  return effects.content
}
function fixture(content: ContentCatalog) {
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
it('resolves real npm dependency edges beneath UUID ancestor paths without using sanitized npm paths', async () => {
  const directory = join(root, randomUUID(), 'workspace', randomUUID(), 'environment')
  await mkdir(directory, { recursive: true })
  await cp(join(environment, 'package.json'), join(directory, 'package.json'))
  await exec('npm', ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], { cwd: directory })
  const before = await inspectNpmProject(environment)
  const actual = await inspectNpmProject(directory)
  expect(actual.packages).toEqual(before.packages)
  expect(actual.digest).toBe(before.digest)
  expect(actual.packages.find(pkg => pkg.name === '@arcadia-test/slow')?.dependencies).toEqual({
    'arcadia-test-library': 'node_modules/arcadia-test-library',
  })
  expect((await prepare(directory)).content.getSkill('slow:strike' as never).power).toBe(30)
})
it.each(['outside', 'inside'])('still rejects %s package links beneath a UUID ancestor', async targetKind => {
  const directory = join(root, randomUUID(), 'linked-installation')
  await mkdir(directory, { recursive: true })
  await cp(join(environment, 'package.json'), join(directory, 'package.json'))
  await exec('npm', ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], { cwd: directory })
  expect((await inspectNpmProject(directory)).packages).toHaveLength(2)
  const installed = join(directory, 'node_modules', 'arcadia-test-library')
  const target =
    targetKind === 'inside' ? join(directory, 'elsewhere', 'library') : join(root, 'linked-' + randomUUID())
  await mkdir(target, { recursive: true })
  await cp(installed, target, { recursive: true })
  await rm(installed, { recursive: true })
  await symlink(target, installed, process.platform === 'win32' ? 'junction' : 'dir')
  await expect(inspectNpmProject(directory)).rejects.toThrow(/Linked package|npm rejected/)
})
it.each([
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
  const prepared = await prepare(),
    content = await reference(prepared)
  expect(process.env.ARCADIA_NPM_TEST_LOADED).toBeUndefined()
  const f = fixture(content),
    other = fixture(await reference(prepared)),
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
  expect(b.sandbox.revision).toBe(a.sandbox.revision)
}, 30000)
it('allows local code edits without renewed approval while preserving the existing catalog', async () => {
  const before = await prepare(),
    file = join(environment, 'node_modules/arcadia-test-library/index.js')
  const old = await readFile(file, 'utf8')
  try {
    await writeFile(file, 'export const penalty = -90')
    const next = await prepareNpmProject(environment, host, {
      policy: { trust: 'local-development' },
    })
    environments.push(next)
    expect(next.installation.digest).toBe(before.installation.digest)
    expect(next.sandbox.revision).not.toBe(before.sandbox.revision)
    const changed = fixture(await reference(next)),
      changedSpeed = changed.b.activePet.stat.spe
    changed.battle.applyEffects(changed.event(), EffectTrigger.OnHit)
    expect(changed.b.activePet.stat.spe).toBe(changedSpeed - 90)
    const f = fixture(await reference(before)),
      speed = f.b.activePet.stat.spe
    f.battle.applyEffects(f.event(), EffectTrigger.OnHit)
    expect(f.b.activePet.stat.spe).toBe(speed - 25)
  } finally {
    await writeFile(file, old)
  }
})

it('restores runtime parameters and source bindings at an existing selection checkpoint, then expires naturally', async () => {
  const loaded = await prepare(),
    content = await reference(loaded),
    f = fixture(content),
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
  content
    .parametersFor(effect.id)!
    .set(f.battle.configSystem, parameterAddress(effect.id, 'parameters', 'amount'), -35, source)
  expect(f.b.activePet.stat.spe).toBe(speed - 35)
  const snapshot = JSON.parse(JSON.stringify(content.snapshot(f.battle)))
  await f.battle.cleanup()
  await running
  const restored = (await reference(await prepare())).restore(snapshot)
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

it('rebuilds UGC parameters, custom binding computations and source lifetimes in a fresh Worker', async () => {
  const file = join(environment, 'node_modules/@arcadia-test/slow/effects.js'),
    original = await readFile(file, 'utf8')
  const workers = createNodeBattleWorkerManager()
  try {
    await writeFile(
      file,
      original.replace(
        "value: amount.follow({ key: 'amount' })",
        "value: amount.follow({ key: 'amount' }).map(value => value - 10)",
      ),
    )
    const prepared = await prepare()
    // Reuse the ordinary input schema; no engine objects cross the Worker boundary.
    const spec = {
      environment: prepared.sandbox,
      players: [0, 1].map(side => ({
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
            maxHp: 10_000,
            evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
            ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
          },
        ],
      })),
      options: { rngSeed: 'ugc-worker-restore', timerConfig: { enabled: false }, showHidden: true },
    }
    const battle = await workers.create(spec)
    await battle.ready()
    const initial = await battle.getState(undefined, true),
      speed = initial.players[1].team![0].stats!.spe
    async function turn(system: typeof battle, skill: string) {
      const pending = await system.waitForPendingDecision(),
        state = await system.getState(undefined, true)
      for (const [seat, choices] of pending.selections.entries()) {
        const id = state.players[seat].team![0].skills!.find(entry => entry.baseId === skill)!.id
        await system.submitAction(choices.find(action => action.type === 'use-skill' && action.skill === id)!)
      }
      await system.waitForPendingDecision()
      return system.getState(undefined, true)
    }
    const before = await turn(battle, 'slow:strike')
    expect(before.players[1].team![0].stats!.spe).toBe(speed - 35)
    expect(before.players[1].team![0].marks[0].duration).toBe(1)
    const snapshot = await battle.createRuntimeSnapshot()
    await battle.cleanup()
    const restored = await workers.create(spec)
    expect(restored.id).not.toBe(battle.id)
    await restored.restoreRuntimeSnapshot(JSON.parse(JSON.stringify(snapshot)))
    await restored.ready()
    expect(await restored.getState(undefined, true)).toEqual(before)
    const after = await turn(restored, 'slow:rest')
    expect(after.players[1].team![0].marks).toHaveLength(0)
    expect(after.players[1].team![0].stats!.spe).toBe(speed)
    await restored.cleanup()
    expect(workers.status().every(entry => entry.cleanup === 'graceful')).toBe(true)
  } finally {
    await workers.dispose()
    await writeFile(file, original)
  }
}, 30_000)

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

it('rejects incompatible SDKs, escaping paths, and missing referenced effects with diagnostics', async () => {
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
  await expect(reference(await prepare(dir))).rejects.toThrow()
})

it('accepts unused code definitions without a duplicate package export list', async () => {
  const dir = join(root, 'unused-effect')
  await cp(environment, dir, { recursive: true })
  const module = join(dir, 'node_modules/@arcadia-test/slow/effects.js')
  await writeFile(
    module,
    effectModule.replace(
      '  return [',
      `  return [
    sdk.defineCodeEffect({ id: id('unused'), sourceKind: 'skill', triggers: [sdk.EffectTrigger.OnHit], apply() {} }),`,
    ),
  )
  const prepared = await prepare(dir)
  expect(prepared.content.effectIds.some(id => id.includes('unused'))).toBe(false)
  const f = fixture(await reference(prepared))
  const speed = f.b.activePet.stat.spe
  f.battle.applyEffects(f.event(), EffectTrigger.OnHit)
  expect(f.b.activePet.stat.spe).toBe(speed - 25)
})
it('checks the actual effect source kind and rejects duplicate returned IDs', async () => {
  const dir = join(root, 'wrong-effect')
  await cp(environment, dir, { recursive: true })
  const module = join(dir, 'node_modules/@arcadia-test/slow/effects.js')
  await writeFile(
    module,
    effectModule.replace("id: id('apply'), sourceKind: 'skill'", "id: id('apply'), sourceKind: 'petMark'"),
  )
  await expect(reference(await prepare(dir))).rejects.toThrow()
  await writeFile(module, effectModule.replace("id: id('penalty')", "id: id('apply')"))
  await expect(reference(await prepare(dir))).rejects.toThrow('duplicated')
})

it('resolves an effect referenced only by another installed content package', async () => {
  const dir = join(root, 'cross-package-effect')
  await cp(environment, dir, { recursive: true })
  const provider = join(dir, 'node_modules/@arcadia-test/slow/content.json')
  const providerData = JSON.parse(await readFile(provider, 'utf8'))
  providerData.data.skills.find((skill: { id: string }) => skill.id === 'strike').behaviors = []
  await writeFile(provider, JSON.stringify(providerData))
  const artifact = await pack(
    'effect-consumer',
    {
      name: '@arcadia-test/effect-consumer',
      version: '1.0.0',
      dependencies: { '@arcadia-test/slow': '1.0.0' },
      arcadia: { formatVersion: 1, projectId: 'consumer', namespace: 'consumer', content: 'content.json' },
    },
    {
      'content.json': JSON.stringify({
        data: {
          species: [],
          marks: [],
          behaviors: [],
          skills: [
            {
              id: 'copy',
              element: 'Normal',
              category: 'Physical',
              power: 1,
              rage: 0,
              accuracy: 100,
              behaviors: [{ useId: 'slow', definitionId: ref('behavior', 'apply') }],
            },
          ],
        },
      }),
    },
  )
  await exec('npm', ['install', artifact, '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dir })
  const prepared = await prepare(dir)
  expect((await reference(prepared)).getSkill('consumer:copy' as never).effects).toHaveLength(1)
})

it('requires the current npm lockfile format rather than accepting the legacy v2 tree', async () => {
  const dir = join(root, 'old-lockfile')
  await cp(environment, dir, { recursive: true })
  const file = join(dir, 'package-lock.json')
  const lock = JSON.parse(await readFile(file, 'utf8'))
  lock.lockfileVersion = 2
  await writeFile(file, JSON.stringify(lock))
  await expect(inspectNpmProject(dir)).rejects.toThrow('lockfile v3')
})

it('lists a shared transitive resource once and rejects two versions even with different content identities', async () => {
  const empty = { 'content.json': JSON.stringify({ data: { species: [], skills: [], marks: [], behaviors: [] } }) }
  const contentManifest = (name: string, version: string, identity: string, dependencies = {}) => ({
    name,
    version,
    dependencies,
    arcadia: { formatVersion: 1, projectId: identity, namespace: identity, content: 'content.json' },
  })
  const nature = await pack('shared-nature', contentManifest('@shared/nature', '1.6.3', 'nature'), empty)
  const nature2 = await pack('shared-nature-v2', contentManifest('@shared/nature', '2.1.0', 'nature-v2'), empty)
  const forest = await pack(
    'shared-forest',
    contentManifest('@shared/forest', '1.0.0', 'forest', { '@shared/nature': `file:${nature}` }),
    empty,
  )
  const arena = await pack(
    'shared-arena',
    contentManifest('@shared/arena', '1.0.0', 'arena', { '@shared/nature': `file:${nature}` }),
    empty,
  )
  const wild = await pack(
    'shared-wild',
    contentManifest('@shared/wild', '1.0.0', 'wild', { '@shared/nature': `file:${nature2}` }),
    empty,
  )
  async function install(name: string, dependencies: Record<string, string>) {
    const directory = join(root, name)
    await mkdir(directory)
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ name, version: '1.0.0', private: true, dependencies }),
    )
    await exec('npm', ['install', '--ignore-scripts', '--strict-peer-deps', '--offline', '--no-audit', '--no-fund'], {
      cwd: directory,
    })
    return directory
  }
  const compatible = await install('shared-compatible', {
    '@shared/forest': `file:${forest}`,
    '@shared/arena': `file:${arena}`,
  })
  const inspection = await inspectNpmProject(compatible)
  expect(inspection.members).toHaveLength(3)
  expect(inspection.members.find(member => member.name === '@shared/nature')).toMatchObject({
    version: '1.6.3',
    direct: false,
    requiredBy: ['@shared/arena', '@shared/forest'],
    dependencies: [],
  })
  expect(inspection.members.find(member => member.name === '@shared/forest')).toMatchObject({
    direct: true,
    dependencies: ['@shared/nature'],
  })
  const conflicting = await install('shared-conflicting', {
    '@shared/forest': `file:${forest}`,
    '@shared/wild': `file:${wild}`,
  })
  await expect(inspectNpmProject(conflicting)).rejects.toThrow('must have one installed version')
}, 60000)

it('loads an installed official catalog alongside ordinary npm content dependencies', async () => {
  const baseSkill = { id: 'skill_zhuangji', element: 'Normal', category: 'Physical', power: 35, rage: 0, accuracy: 100 }
  const base = await pack(
    'official-base',
    {
      name: '@arcadia-eternity/data-pack-base',
      version: '1.0.0',
      arcadiaEternityPack: 'pack.json',
      arcadia: {
        formatVersion: 1,
        projectId: 'base',
        namespace: 'base',
        content: 'content.json',
        catalog: 'catalog.json',
        effectArtifact: 'effects.json',
        sdkApi: 2,
      },
    },
    {
      'pack.json': '{}',
      'content.json': JSON.stringify({ data: { species: [], skills: [baseSkill], marks: [] } }),
      'catalog.json': JSON.stringify({
        formatVersion: 1,
        build: host.build,
        templates: [],
        effectIds: [],
      }),
      'effects.json': JSON.stringify({
        format: 'arcadia.effect-module',
        version: 1,
        sdkApi: 2,
        packageId: '@arcadia-eternity/data-pack-base',
        source: 'export function createCatalog() { return { effects: new Map(), parameters: new Map() } }',
      }),
    },
  )
  const consumerData = {
    ...structuredClone(data),
    skills: [],
    marks: [],
    species: [
      {
        ...structuredClone(data.species[0]!),
        learnable_skills: [
          { skill_id: 'skill_zhuangji', level: 1, hidden: false },
          { skill_id: ref('skill', 'strike'), level: 1, hidden: false },
        ],
      },
    ],
  }
  const consumer = await pack(
    'base-consumer',
    {
      name: '@arcadia-test/base-consumer',
      version: '1.0.0',
      dependencies: {
        '@arcadia-eternity/data-pack-base': `file:${base}`,
        '@arcadia-test/slow': `file:${join(root, 'content/arcadia-test-slow-1.0.0.tgz')}`,
      },
      arcadia: { formatVersion: 1, projectId: 'base-consumer', namespace: 'consumer', content: 'content.json' },
    },
    { 'content.json': JSON.stringify({ data: consumerData }) },
  )
  const directory = join(root, 'base-environment')
  await mkdir(directory)
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({
      name: 'base-environment',
      version: '1.0.0',
      private: true,
      dependencies: { '@arcadia-test/base-consumer': `file:${consumer}` },
    }),
  )
  await exec('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory })
  const prepared = await prepare(directory)
  expect(prepared.content.getSkill('skill_zhuangji').power).toBe(35)
  expect(prepared.content.getSkill('slow:strike').power).toBe(30)
  expect(prepared.data.species.find(row => row.id === 'consumer:pet')?.learnable_skills).toEqual([
    { skill_id: 'skill_zhuangji', level: 1, hidden: false },
    { skill_id: 'slow:strike', level: 1, hidden: false },
  ])
  const content = await prepareSandboxContent(prepared.sandbox)
  try {
    expect(content.content.getSkill('skill_zhuangji').power).toBe(35)
  } finally {
    content.dispose()
  }
  const baseMember = prepared.installation.members.find(pkg => pkg.projectId === 'base')!
  expect(baseMember.requiredBy).toContain('@arcadia-test/base-consumer')
  expect(baseMember.direct).toBe(false)
  // A rebuilt server must load the unchanged saved installation with the same
  // material revision; the host binary hash is not a content compatibility API.
  const rebuilt = await prepareNpmProject(
    directory,
    { ...host, build: { formatVersion: 1, coreBuildId: 'c'.repeat(64), registryBuildId: 'e'.repeat(64) } },
    { policy: { trust: 'local-development' } },
  )
  environments.push(rebuilt)
  expect(rebuilt.revision).toBe(prepared.revision)
  const rebuiltContent = await prepareSandboxContent(rebuilt.sandbox)
  try {
    expect(rebuiltContent.content.getSkill('skill_zhuangji').power).toBe(35)
    expect(rebuiltContent.content.getSkill('slow:strike').power).toBe(30)
  } finally {
    rebuiltContent.dispose()
  }
  await expect(
    prepareNpmProject(
      directory,
      {
        ...host,
        build: { ...host.build, registryBuildId: 'd'.repeat(64) },
        base: { ...host.base, skills: [baseSkill] },
      },
      { policy: {} },
    ),
  ).rejects.toThrow('Installed official base differs from the host catalog')
  const baseOnly = join(root, 'base-only')
  await mkdir(baseOnly)
  await writeFile(
    join(baseOnly, 'package.json'),
    JSON.stringify({
      name: 'base-only',
      version: '1.0.0',
      private: true,
      dependencies: { '@arcadia-eternity/data-pack-base': `file:${base}` },
    }),
  )
  await exec('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: baseOnly })
  const standalone = await prepare(baseOnly)
  expect(standalone.content.getSkill('skill_zhuangji').power).toBe(35)
})
