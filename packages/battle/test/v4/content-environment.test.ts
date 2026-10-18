import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  lockContentEnvironment,
  contentEnvironmentPolicy,
  SnapshotCatalog,
  BattleMessageType,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  setGlobalLogger,
  type Battle,
  type EnvironmentBuildIdentity,
  type ContentEnvironment,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const raw = readFileSync(new URL('../../../../docs/v4/examples/ugc-recovery-pack.json', import.meta.url), 'utf8')
const build: EnvironmentBuildIdentity = JSON.parse(
  readFileSync(new URL('../../dist/environment-build.json', import.meta.url), 'utf8'),
)
const input = () => JSON.parse(raw)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
function room(environment: ContentEnvironment) {
  const f = makeScenario(267)
  battles.push(f.battle)
  for (const pet of [...f.a.team, ...f.b.team])
    for (const skill of pet.skills) {
      skill.base.effects.splice(0)
      skill.effects.splice(0)
    }
  f.a.activePet.skills[0].effects.push(environment.packs[0].rules[0].effect)
  environment.install(f.battle)
  return f
}
function apply(battle: Battle) {
  const player = battle.playerA,
    owner = player.activePet,
    skill = owner.skills[0]
  battle.applyEffects(
    new UseSkillContext(new TurnContext(battle), player, owner, AttackTargetOpinion.opponent, skill),
    EffectTrigger.OnHit,
    skill,
  )
}
function tick(battle: Battle) {
  const owner = battle.playerA.activePet
  owner.currentHp = 1
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd)
  return owner.currentHp - 1
}
it('uses the actual bundled implementation bytes for both trusted build boundaries', () => {
  const code = readFileSync(new URL('../../dist/environment-runtime.mjs', import.meta.url), 'utf8')
  expect(build.coreBuildId).toBe(hash(`arcadia-core/1\0${code}`))
  expect(build.registryBuildId).toBe(hash(`arcadia-registry/1\0${code}`))
  expect(build.coreBuildId).not.toBe(hash(`arcadia-core/1\0${code}\n// changed implementation`))
})
it('separates transport integrity from normalized content identity and defaults', async () => {
  const first = await lockContentEnvironment([raw], build)
  const normalized = JSON.stringify(first.packs[0].data)
  const second = await lockContentEnvironment([normalized], build, first.manifest.environmentDigest)
  expect(second.manifest).toEqual(first.manifest)
  expect(second.transport).not.toEqual(first.transport)
  expect(first.transport[0].transportDigest).toBe(hash(raw))
  expect(second.transport[0].transportDigest).toBe(hash(normalized))
  const reordered = JSON.stringify(JSON.parse(raw), null, 4)
  expect((await lockContentEnvironment([reordered], build)).manifest).toEqual(first.manifest)
  expect(Object.isFrozen(first.manifest.packs)).toBe(true)
  expect(Object.isFrozen(first.packs[0].data.rules[0].rule.actions)).toBe(true)
})
it('ignores pack-set ordering while preserving semantic action ordering', async () => {
  const other = JSON.stringify({ formatVersion: 1, id: 'other' })
  const first = await lockContentEnvironment([raw, other], build)
  expect((await lockContentEnvironment([other, raw], build)).manifest).toEqual(first.manifest)
  const data = input()
  data.rules[0].rule.actions.push({ ...data.rules[0].rule.actions[0], stepId: 'second' })
  const forward = await lockContentEnvironment([JSON.stringify(data)], build)
  data.rules[0].rule.actions.reverse()
  expect((await lockContentEnvironment([JSON.stringify(data)], build)).manifest.environmentDigest).not.toBe(
    forward.manifest.environmentDigest,
  )
})
it.each(['coreBuildId', 'registryBuildId'] as const)('rejects a peer running different %s', async key => {
  const first = await lockContentEnvironment([raw], build)
  await expect(
    lockContentEnvironment([raw], { ...build, [key]: hash('different build') }, first.manifest.environmentDigest),
  ).rejects.toThrow('digest mismatch')
})
it('rejects altered content against the agreed identity without mutating an existing room', async () => {
  const first = await lockContentEnvironment([raw], build),
    f = room(first)
  const changed = input()
  changed.rules[0].rule.parameters.recovery.value = 0.4
  await expect(
    lockContentEnvironment([JSON.stringify(changed)], build, first.manifest.environmentDigest),
  ).rejects.toThrow('digest mismatch')
  apply(f.battle)
  expect(tick(f.battle)).toBe(Math.floor(f.a.activePet.stat.maxHp * 0.2))
})
it.each([
  ['duplicate pack', [raw, raw]],
  [
    'overlapping namespace',
    [
      JSON.stringify({ formatVersion: 1, id: 'a', marks: [{ id: 'a/b/mark' }] }),
      JSON.stringify({ formatVersion: 1, id: 'a/b', marks: [{ id: 'a/b/mark' }] }),
    ],
  ],
  ['invalid JSON', ['{']],
  ['invalid pack', ['null']],
  [
    'unknown executable capability',
    [
      JSON.stringify({
        ...input(),
        rules: [
          {
            sourceKind: 'skill',
            rule: {
              formatVersion: 1,
              id: 'ugc/bad',
              trigger: { nodeId: 't', id: 'core.selfSkillHit' },
              actions: [{ stepId: 'a', id: 'uploaded.script' }],
            },
          },
        ],
      }),
    ],
  ],
  ['no packs', []],
  ['too many packs', Array(33).fill(raw)],
  ['pack byte limit', [' '.repeat(contentEnvironmentPolicy.maxPackBytes + 1)]],
  ['aggregate byte limit', Array(5).fill(' '.repeat(contentEnvironmentPolicy.maxPackBytes))],
] as const)('rejects %s before publishing an environment', async (_name, texts) => {
  await expect(lockContentEnvironment(texts, build)).rejects.toThrow()
})
it('copies all inputs before asynchronous digest work', async () => {
  const texts = [raw],
    identity = { ...build }
  const pending = lockContentEnvironment(texts, identity)
  texts[0] = '{}'
  identity.coreBuildId = hash('changed later')
  const environment = await pending
  expect(environment.manifest.coreBuildId).toBe(build.coreBuildId)
  expect(environment.packs[0].data.id).toBe('ugc')
})
it('keeps two same-ID rooms independent through shutdown and fresh-environment restoration', async () => {
  const changed = input()
  changed.rules[0].rule.parameters.recovery.value = 0.4
  const first = await lockContentEnvironment([raw], build)
  const second = await lockContentEnvironment([JSON.stringify(changed)], build)
  expect(first.manifest.environmentDigest).not.toBe(second.manifest.environmentDigest)
  const a = room(first),
    b = room(second)
  const ready = new Promise<void>(resolve =>
    a.battle.registerListener(message => {
      if (message.type === BattleMessageType.TurnAction) resolve()
    }),
  )
  const running = a.battle.startBattle().catch(error => {
    if (error.message !== 'Battle cancelled') throw error
  })
  await Promise.race([
    ready,
    running.then(() => {
      throw new Error('Battle ended before checkpoint')
    }),
  ])
  apply(a.battle)
  apply(b.battle)
  const payload = JSON.parse(JSON.stringify(first.snapshot(a.battle)))
  expect(payload.catalog).toBe(first.manifest.environmentDigest)
  expect(() => second.snapshot(a.battle)).toThrow('different content environment')
  expect(() => second.restore(payload)).toThrow()
  const configCount = a.battle.configSystem.getRegisteredKeys().length
  expect(() => first.install(a.battle)).toThrow('already has')
  expect(a.battle.configSystem.getRegisteredKeys()).toHaveLength(configCount)
  await a.battle.cleanup()
  await running
  expect(tick(b.battle)).toBe(Math.floor(b.a.activePet.stat.maxHp * 0.4))
  const fresh = await lockContentEnvironment(
    [JSON.stringify(first.packs[0].data)],
    build,
    first.manifest.environmentDigest,
  )
  const restored = fresh.restore(payload)
  battles.push(restored)
  expect(restored.playerA.activePet.marks[0].base).toBe(fresh.packs[0].marks[0])
  expect(restored.playerA.activePet.marks[0].instanceParams).toEqual({ ratio: 0.2 })
  expect(tick(restored)).toBe(Math.floor(restored.playerA.activePet.stat.maxHp * 0.2))
  expect(() => fresh.install(restored)).toThrow('already has')
  expect(() => first.snapshot(restored)).toThrow('different content environment')
  expect(fresh.snapshot(restored).catalog).toBe(payload.catalog)
})
it('seals snapshot registration without disabling lookup', async () => {
  const environment = await lockContentEnvironment([raw], build)
  const effect = environment.packs[0].rules[0].effect,
    mark = environment.packs[0].marks[0]
  const catalog = new SnapshotCatalog('fixture/sealed')
    .registerEffect(effect.id, effect)
    .registerContent(mark.id, mark)
    .seal()
  expect(catalog.resolveEffect(effect.id)).toBe(effect)
  expect(catalog.resolveContent(mark.id)).toBe(mark)
  expect(() => catalog.registerEffect(effect.id, effect)).toThrow('sealed')
  expect(() => catalog.registerContent(mark.id, mark)).toThrow('sealed')
  expect(() =>
    catalog.registerValue('late', () => {
      throw new Error('unused')
    }),
  ).toThrow('sealed')
})

it('preflights all parameter collisions before installing or claiming a battle', async () => {
  const environment = await lockContentEnvironment([raw], build)
  const f = makeScenario(268)
  battles.push(f.battle)
  const address = environment.packs[0].rules[0].parameterDefinitions[0].address
  f.battle.configSystem.registerTaggedConfig(address, 99, [])
  const keys = [...f.battle.configSystem.getRegisteredKeys()]
  expect(() => environment.install(f.battle)).toThrow('already registered')
  expect(f.battle.configSystem.getRegisteredKeys()).toEqual(keys)
  expect(f.battle.configSystem.get(address)).toBe(99)
  const empty = await lockContentEnvironment([JSON.stringify({ formatVersion: 1, id: 'empty' })], build)
  expect(() => empty.install(f.battle)).not.toThrow()
})
