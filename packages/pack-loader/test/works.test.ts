import * as authoringSdk from '@arcadia-eternity/battle/authoring'
import { expect, it } from 'vitest'
import {
  createContentCatalog,
  defineNativeBehavior,
  EffectTrigger,
  UseSkillContext,
  TurnContext,
  AttackTargetOpinion,
  Nature,
  setGlobalLogger,
  type BaseMark,
  type BehaviorDefinition,
} from '@arcadia-eternity/battle/engine'
import {
  createDraft,
  compileRelease,
  prepareWorkEnvironment,
  workRef,
  runtimeId,
  parseDraft,
  forkDraft,
  exportArchive,
  parseArchive,
} from '../src/works'

const applyMarkDefinition: BehaviorDefinition = {
  formatVersion: 1,
  id: 'test/template/apply-mark',
  sourceKind: 'skill',
  parameters: { mark: { kind: 'string', default: '', maxLength: 256, reference: 'mark', static: true } },
  implementation: { kind: 'native', exportId: 'test/native/apply-mark' },
}
const markAttributeDefinition: BehaviorDefinition = {
  formatVersion: 1,
  id: 'test/template/mark-attribute',
  sourceKind: 'petMark',
  parameters: {
    attribute: { kind: 'string', default: 'spe', enum: ['atk', 'def', 'spa', 'spd', 'spe'], static: true },
    operation: { kind: 'string', default: 'delta', enum: ['delta', 'percent'], static: true },
    amount: { kind: 'number', default: 10, minimum: -1000, maximum: 1000 },
  },
  implementation: { kind: 'native', exportId: 'test/native/mark-attribute' },
}
const testNativeExports = (marks: ReadonlyMap<string, BaseMark>) => [
  defineNativeBehavior({
    id: 'test/native/apply-mark',
    sourceKind: 'skill',
    parameters: applyMarkDefinition.parameters,
    build({ effectId, params }) {
      const mark = marks.get(String(params.mark))
      if (!mark) throw new Error(`Missing mark: ${String(params.mark)}`)
      return {
        id: effectId,
        triggers: [EffectTrigger.OnHit],
        parameters: { mark: authoringSdk.stringParam({ default: String(params.mark) }) },
        apply: authoringSdk.targets.opponentActive.apply(authoringSdk.ops.addMark(mark)),
      }
    },
  }),
  defineNativeBehavior({
    id: 'test/native/mark-attribute',
    sourceKind: 'petMark',
    parameters: markAttributeDefinition.parameters,
    build({ effectId, params }) {
      const amount = authoringSdk.numberParam({ default: Number(params.amount) })
      return {
        id: effectId,
        triggers: [EffectTrigger.OnMarkCreated],
        rebindOnOwnerTransfer: true,
        parameters: { amount },
        apply: authoringSdk.targets.ownerPet.apply(
          authoringSdk.ops.addAttributeModifier(
            String(params.attribute) as 'atk' | 'def' | 'spa' | 'spd' | 'spe',
            String(params.operation) as 'delta' | 'percent',
            amount,
          ),
        ),
      }
    },
  }),
]
const host = {
  build: { formatVersion: 1, coreBuildId: 'a'.repeat(64), registryBuildId: 'b'.repeat(64) } as const,
  base: { marks: [], skills: [], species: [] },
  templates: [applyMarkDefinition, markAttributeDefinition],
  createContent: (data: Parameters<typeof createContentCatalog>[0], revision: string) =>
    createContentCatalog(data, revision, undefined, context => ({
      nativeExports: testNativeExports(context.marks),
    })),
}
const skill = (id: string) => ({ id, element: 'Normal', category: 'Physical', power: 40, rage: 0, accuracy: 100 })

it('preserves exact SemVer build metadata in releases and dependency locks', async () => {
  const dependency = createDraft('semver-dependency', 'Dependency')
  dependency.data.skills.push(skill('strike'))
  const release = await compileRelease(dependency, '1.0.0-beta.1+build.3', host)
  const draft = createDraft('semver-consumer', 'Consumer')
  draft.dependencies.push({ projectId: release.project.id, version: release.releaseVersion, digest: release.digest })
  const consumer = await compileRelease(draft, '1.0.0+build.4', host, [release])
  const prepared = await prepareWorkEnvironment(host, [consumer], [release])
  expect(prepared.releases.map(item => item.releaseVersion)).toEqual(['1.0.0-beta.1+build.3', '1.0.0+build.4'])
  for (const version of ['v1.0.0', '01.0.0', '^1.0.0', '1.0.0-01'])
    await expect(compileRelease(draft, version, host, [release])).rejects.toThrow()
})

it('publishes independent namespaced works and freezes the running version while the draft changes', async () => {
  const a = createDraft('author-a', '作品 A')
  a.data.marks.push({
    id: 'slow',
    tags: ['status'],
    config: { duration: 2, maxStacks: 3, stackable: true },
    behaviors: [
      {
        useId: 'speed',
        definitionId: 'test/template/mark-attribute',
        params: { attribute: 'spe', operation: 'delta', amount: -10 },
      },
    ],
  })
  a.data.skills.push(skill('strike'))
  const releaseA = await compileRelease(a, '1.0.0', host)
  const b = createDraft('author-b', '作品 B')
  b.dependencies.push({ projectId: a.project.id, version: releaseA.releaseVersion, digest: releaseA.digest })
  b.data.skills.push({
    ...skill('strike'),
    behaviors: [
      {
        useId: 'slow',
        definitionId: 'test/template/apply-mark',
        params: { mark: workRef(a.project.id, 'mark', 'slow') },
      },
    ],
  })
  b.data.species.push({
    id: 'pet',
    num: 1,
    element: 'Normal',
    baseStats: { hp: 100, atk: 100, spa: 100, def: 100, spd: 100, spe: 100 },
    genderRatio: null,
    heightRange: [1, 2],
    weightRange: [1, 2],
    ability: [],
    emblem: [],
    learnable_skills: [{ skill_id: workRef(b.project.id, 'skill', 'strike'), level: 1, hidden: false }],
  })
  const releaseB = await compileRelease(b, '1.0.0', host, [releaseA])
  const environment = await prepareWorkEnvironment(host, [releaseB], [releaseA, releaseB])
  expect(environment.content.skills).toHaveLength(2)
  expect(environment.content.getSkill(runtimeId('author-a', 'strike') as never).power).toBe(40)
  b.data.skills[0].power = 90
  expect(environment.content.getSkill(runtimeId('author-b', 'strike') as never).power).toBe(40)
  const players = environment.content.parsePlayers(
    [0, 1].map(side => ({
      id: String(side).repeat(21),
      name: `Player ${side}`,
      team: [
        {
          id: String(side + 2).repeat(21),
          name: '测试精灵',
          species: 'author-b:pet',
          level: 100,
          nature: Nature.Hardy,
          skills: ['author-b:strike'],
          evs: { hp: 0, atk: 0, spa: 0, def: 0, spd: 0, spe: 0 },
          ivs: { hp: 31, atk: 31, spa: 31, def: 31, spd: 31, spe: 31 },
        },
      ],
    })),
  )
  setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
  const battle = environment.content.createBattle(players[0], players[1], {
    rngSeed: 'work-reference',
    timerConfig: { enabled: false },
  })
  try {
    const originalSpeed = players[1].activePet.stat.spe
    const event = new UseSkillContext(
      new TurnContext(battle),
      players[0],
      players[0].activePet,
      AttackTargetOpinion.opponent,
      players[0].activePet.skills[0],
    )
    event.updateActualTarget()
    battle.applyEffects(event, EffectTrigger.OnHit)
    expect(players[1].activePet.marks[0].baseId).toBe('author-a:slow')
    expect(players[1].activePet.stat.spe).toBe(originalSpeed - 10)
  } finally {
    await battle.cleanup()
  }
  expect((await compileRelease(b, '1.0.1', host, [releaseA])).digest).not.toBe(releaseB.digest)
})

it('forks declared references into a new namespace without rewriting labels or external references', async () => {
  const draft = createDraft('source-project', '原作', 'frost')
  draft.data.marks.push({ id: 'slow', config: { duration: 2 } })
  draft.data.skills.push({
    ...skill('strike'),
    description: 'frost:strike',
    behaviors: [
      {
        useId: 'mark',
        definitionId: 'test/template/apply-mark',
        params: { mark: workRef('source-project', 'mark', 'slow') },
      },
    ],
  })
  const copy = forkDraft(draft, 'copy-project', 'ember')
  expect(copy.project.namespace).toBe('ember')
  expect(copy.data.skills[0].description).toBe('frost:strike')
  const release = await compileRelease(copy, '1.0.0', host)
  expect((await prepareWorkEnvironment(host, [release])).content.getSkill('ember:strike' as never)).toBeDefined()
  expect(draft.project.namespace).toBe('frost')
})

it('round-trips an archive and re-validates tampered content on parse', async () => {
  const draft = createDraft('ice', '寒冰')
  draft.data.skills.push(skill('strike'))
  const release = await compileRelease(draft, '1.0.0', host)
  const text = await exportArchive({ drafts: [draft], selected: [release], installed: [release] })
  const archive = await parseArchive(text)
  expect(archive.releases[0].digest).toBe(release.digest)
  const tampered = JSON.parse(text)
  tampered.releases[0].data.skills[0].power = 999
  expect((await parseArchive(tampered)).releases[0].data.skills[0].power).toBe(999)
})

it('keeps installed but unselected releases out of environment identity', async () => {
  const a = await compileRelease(createDraft('one', '一'), '1.0.0', host)
  const b = await compileRelease(createDraft('two', '二'), '1.0.0', host)
  expect((await prepareWorkEnvironment(host, [a], [a, b])).revision).toBe(
    (await prepareWorkEnvironment(host, [a], [a])).revision,
  )
})

it('round-trips unfinished drafts but refuses to publish incomplete runtime data', async () => {
  const draft = createDraft('unfinished', '未完成')
  draft.data.skills.push({ id: 'empty' })
  expect(parseDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft)
  await expect(compileRelease(draft, '1.0.0', host)).rejects.toThrow()
})

it('uses namespace:id without encoding the content kind and rejects conflicting namespaces', async () => {
  const a = createDraft('project-123', '寒霜', 'frost-pack')
  a.data.skills.push(skill('ice_strike'))
  a.data.marks.push({ id: 'ice_strike', config: { duration: 2 } })
  const release = await compileRelease(a, '1.0.0', host)
  const environment = await prepareWorkEnvironment(host, [release])
  expect(environment.content.skills[0].id).toBe('frost-pack:ice_strike')
  expect(environment.content.marks[0].id).toBe('frost-pack:ice_strike')
  const b = createDraft('project-456', '另一个作品', 'frost-pack')
  b.data.skills.push(skill('other'))
  const other = await compileRelease(b, '1.0.0', host)
  await expect(prepareWorkEnvironment(host, [release, other])).rejects.toMatchObject({
    diagnostics: [expect.objectContaining({ code: 'NAMESPACE_CONFLICT' })],
  })
})

it('validates namespace syntax, path IDs, reserved names and malformed manifests before compilation', async () => {
  for (const namespace of ['BadCase', 'bad:namespace', '../bad', 'base', ''])
    expect(() => createDraft('project', '作品', namespace)).toThrow()
  for (const id of ['../escape', 'nested//id', 'nested/../id', 'UPPER', 'other:id'])
    expect(() => runtimeId('pack', id)).toThrow()
  expect(runtimeId('my_pack', 'skills/ice-strike')).toBe('my_pack:skills/ice-strike')
  for (const key of ['assets', 'dependencies', 'requirements'] as const) {
    const draft = createDraft('bad-input', '作品')
    ;(draft[key] as unknown[]).push(null)
    await expect(compileRelease(draft, '1.0.0', host)).rejects.toMatchObject({ name: 'WorkError' })
  }
  expect(() => createDraft('constructor', '作品')).toThrow()
  expect(() => parseDraft({ ...createDraft('override', '作品'), overrides: { base: true } })).toThrow(/未知顶层字段/)
})

it('locks explicit dependencies and rejects missing, conflicting and undeclared references', async () => {
  const a = createDraft('alpha', '一')
  a.data.marks.push({ id: 'status' })
  const one = await compileRelease(a, '1.0.0', host),
    two = await compileRelease(a, '2.0.0', host)
  const b = createDraft('beta', '二')
  b.data.skills.push({
    ...skill('strike'),
    behaviors: [
      {
        useId: 'hit',
        definitionId: 'test/template/apply-mark',
        params: { mark: workRef('alpha', 'mark', 'status') },
      },
    ],
  })
  await expect(compileRelease(b, '1.0.0', host, [one])).rejects.toMatchObject({
    diagnostics: [expect.objectContaining({ code: 'UNDECLARED_DEPENDENCY' })],
  })
  b.dependencies.push({ projectId: 'alpha', version: '1.0.0', digest: one.digest })
  await expect(compileRelease(b, '1.0.0', host)).rejects.toMatchObject({
    diagnostics: [expect.objectContaining({ code: 'MISSING_DEPENDENCY' })],
  })
  const linked = await compileRelease(b, '1.0.0', host, [one])
  await expect(prepareWorkEnvironment(host, [linked, two], [one, two])).rejects.toMatchObject({
    diagnostics: [expect.objectContaining({ code: 'VERSION_CONFLICT' })],
  })
  const left = await prepareWorkEnvironment(host, [one, linked], [one, linked])
  const right = await prepareWorkEnvironment(host, [linked, one, one], [one, linked])
  expect(left.revision).toBe(right.revision)
  const changedBuild = { ...host, build: { ...host.build, registryBuildId: 'c'.repeat(64) } }
  expect((await prepareWorkEnvironment(changedBuild, [one, linked], [one, linked])).revision).not.toBe(left.revision)
})

it('keeps asset keys while checking that referenced bytes exist and have the declared size', async () => {
  const { digestBytes, encodeBytes } = await import('../src/works')
  const bytes = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    hash = await digestBytes(bytes)
  const draft = createDraft('pictures', '素材')
  draft.assets.push({ id: 'portrait', variant: 'image', mime: 'image/png', bytes: bytes.length, sha256: hash })
  await expect(compileRelease(draft, '1.0.0', host)).rejects.toMatchObject({
    diagnostics: [expect.objectContaining({ code: 'ASSET_INTEGRITY' })],
  })
  const release = await compileRelease(draft, '1.0.0', host, [], { [hash]: bytes })
  const archive = await exportArchive({ selected: [release], blobs: { [hash]: encodeBytes(bytes) } })
  expect((await parseArchive(archive)).releases[0].digest).toBe(release.digest)
  const edited = JSON.parse(archive)
  edited.blobs[hash] = encodeBytes(new Uint8Array(bytes.length).fill(1))
  expect((await parseArchive(edited)).releases[0].digest).toBe(release.digest)
  const changed = JSON.parse(archive)
  changed.blobs[hash] = encodeBytes(Uint8Array.of(0, 1, 2))
  await expect(parseArchive(changed)).rejects.toMatchObject({
    diagnostics: [expect.objectContaining({ code: 'ASSET_INTEGRITY' })],
  })
})

it('decodes normal-sized binary assets without recursive regular-expression overflow', async () => {
  const { encodeBytes, decodeBytes } = await import('../src/works')
  const bytes = new Uint8Array(2 * 1024 * 1024).fill(173)
  expect(Buffer.from(decodeBytes(encodeBytes(bytes))).equals(Buffer.from(bytes))).toBe(true)
  for (const text of ['a', '=aaa', 'a===', 'AAAA AAAA']) expect(() => decodeBytes(text)).toThrow()
})

it('enforces host capability permission for host-defined behaviors', async () => {
  const draft = createDraft('capabilities', '受限宿主')
  draft.data.marks.push({
    id: 'buff',
    behaviors: [
      {
        useId: 'speed',
        definitionId: 'test/template/mark-attribute',
        params: { attribute: 'spe', operation: 'delta', amount: 10 },
      },
    ],
  })
  const release = await compileRelease(draft, '1.0.0', host)
  const restricted = { ...host, allowedExports: [] }
  await expect(compileRelease(draft, '1.0.0', restricted)).rejects.toMatchObject({
    diagnostics: [expect.objectContaining({ code: 'UNTRUSTED_CAPABILITY' })],
  })
  await expect(prepareWorkEnvironment(restricted, [release])).rejects.toMatchObject({
    diagnostics: [expect.objectContaining({ code: 'UNTRUSTED_CAPABILITY' })],
  })
})

it('captures inputs before asynchronous hashing so identity and content cannot diverge', async () => {
  const release = JSON.parse(JSON.stringify(await compileRelease(createDraft('snapshot', '快照'), '1.0.0', host)))
  const policy = { mode: 'original' }
  const pending = prepareWorkEnvironment(host, [release], [], policy)
  release.project.id = 'changed'
  policy.mode = 'changed'
  const prepared = await pending
  expect(prepared.manifest.roots[0].projectId).toBe('snapshot')
  expect(prepared.releases[0].project.id).toBe('snapshot')
  expect(prepared.manifest.policy.mode).toBe('original')
})
