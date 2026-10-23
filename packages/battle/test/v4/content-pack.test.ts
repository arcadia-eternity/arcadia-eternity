import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { Type } from '@sinclair/typebox'
import {
  compileContentPack,
  ConfigModifierType,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  BattleMessageType,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  setGlobalLogger,
  type Battle,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const input = () =>
  JSON.parse(readFileSync(new URL('../../../../docs/v4/examples/ugc-recovery-pack.json', import.meta.url), 'utf8'))
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function compile(data = input()) {
  const result = compileContentPack(data)
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result
}
function scenario(pack = compile()) {
  const f = makeScenario(211)
  battles.push(f.battle)
  pack.parameters.install(f.battle.configSystem)
  const skill = f.a.activePet.skills[0]
  skill.effects.splice(0, skill.effects.length, pack.rules[0].effect)
  const apply = () =>
    f.battle.applyEffects(
      new UseSkillContext(new TurnContext(f.battle), f.a, f.a.activePet, AttackTargetOpinion.opponent, skill),
      EffectTrigger.OnHit,
      skill,
    )
  return { ...f, pack, skill, apply }
}

it('loads saved declarations, forward references and ordered effects without native mark callbacks', () => {
  const f = scenario()
  f.apply()
  const owner = f.a.activePet
  expect(owner.marks[0].base).toBe(f.pack.marks[0])
  expect(owner.marks[0].instanceParams).toEqual({ ratio: 0.2 })
  owner.currentHp = 1
  f.battle.applyEffects(new TurnContext(f.battle), EffectTrigger.TurnEnd)
  expect(owner.currentHp).toBe(1 + Math.floor(owner.stat.maxHp * 0.2))
  expect(f.pack.marks[0].effects[0]).toBe(f.pack.rules[1].effect)
  expect(f.pack.data.rules[1].rule.sourceMarkId).toBe('ugc/recovery')
})

it('normalizes defaults and preserves IDs and references on save and fresh compilation', () => {
  const data = input()
  delete data.marks[0].instanceParams.ratio.value
  const first = compile(data)
  const second = compile(JSON.parse(JSON.stringify(first.data)))
  expect(second.data).toEqual(first.data)
  expect(second.marks[0]).not.toBe(first.marks[0])
  expect(second.data.marks[0].instanceParams.ratio.value).toBe(0.2)
  expect(second.data.rules[0].rule.actions[0].params).toMatchObject({
    instanceParams: { ratio: { parameter: 'recovery' } },
  })
  data.marks[0].effects.length = 0
  expect(first.marks[0].effects).toHaveLength(1)
  expect(Object.isFrozen(first.marks[0])).toBe(true)
  expect(Object.isFrozen(first.marks[0].effects)).toBe(true)
  expect(Object.isFrozen(first.data.marks[0].instanceParams)).toBe(true)
})

it('permits empty parameter declarations for ordinary authored marks', () => {
  const pack = compile({ formatVersion: 1, id: 'ugc', marks: [{ id: 'ugc/plain' }] })
  expect(pack.marks[0].createInstance().instanceParams).toEqual({})
  expect(pack.data.marks[0].config.duration).toBe(3)
})

it.each([
  'unknown-preset',
  'bad-parameter',
  'unknown-parameter-field',
  'schema-upload',
  'duplicate-mark',
  'duplicate-rule',
  'duplicate-action',
  'missing-mark',
  'missing-rule',
  'wrong-owner',
  'unowned-rule',
  'skill-as-mark',
  'outside-namespace',
  'unknown-action',
  'unknown-config',
  'invalid-duration',
  'duplicate-effect-reference',
])('rejects the whole candidate: %s', kind => {
  const data = input()
  switch (kind) {
    case 'unknown-preset':
      data.marks[0].instanceParams.ratio.presetId = 'missing'
      break
    case 'bad-parameter':
      data.marks[0].instanceParams.ratio.value = 2
      break
    case 'unknown-parameter-field':
      data.marks[0].instanceParams.ratio.extra = true
      break
    case 'schema-upload':
      data.marks[0].instanceParams.ratio.schema = { type: 'number' }
      break
    case 'duplicate-mark':
      data.marks.push(structuredClone(data.marks[0]))
      break
    case 'duplicate-rule':
      data.rules.push(structuredClone(data.rules[0]))
      break
    case 'duplicate-action':
      data.markActions.push(structuredClone(data.markActions[0]))
      break
    case 'missing-mark':
      data.markActions[0].markId = 'ugc/missing'
      break
    case 'missing-rule':
      data.marks[0].effects = ['ugc/missing']
      data.rules.pop()
      break
    case 'wrong-owner':
      data.rules[1].rule.sourceMarkId = 'ugc/wrong'
      break
    case 'unowned-rule':
      data.marks[0].effects = []
      break
    case 'skill-as-mark':
      data.marks[0].effects = [data.rules[0].rule.id]
      break
    case 'outside-namespace':
      data.marks[0].id = 'someone/mark'
      break
    case 'unknown-action':
      data.rules[1].rule.actions[0].id = 'unknown'
      break
    case 'unknown-config':
      data.marks[0].config = { arbitrary: true }
      break
    case 'invalid-duration':
      data.marks[0].config = { duration: 0 }
      break
    case 'duplicate-effect-reference':
      data.marks[0].effects.push(data.marks[0].effects[0])
      break
  }
  const result = compileContentPack(data)
  expect(result.ok).toBe(false)
  expect(result).not.toHaveProperty('marks')
  expect(result).not.toHaveProperty('registry')
  if (!result.ok) expect(result.diagnostics[0].message.length).toBeGreaterThan(0)
  if (!result.ok && kind === 'missing-rule')
    expect(result.diagnostics[0]).toMatchObject({ contentId: 'ugc/recovery', field: 'effects' })
})

it('keeps previously compiled content usable after a rejected replacement', () => {
  const f = scenario()
  const bad = input()
  bad.rules[1].rule.actions[0].params.ratio = { instanceParameter: 'missing' }
  const rejected = compileContentPack(bad)
  expect(rejected.ok).toBe(false)
  if (!rejected.ok) expect(rejected.diagnostics[0]).toMatchObject({ nodeId: 'recover', code: 'MISSING_REFERENCE' })
  f.apply()
  expect(f.a.activePet.marks[0].base).toBe(f.pack.marks[0])
})

it('preflights all parameter installation before touching an existing battle', () => {
  const pack = compile()
  const f = makeScenario(212)
  battles.push(f.battle)
  const conflicting = pack.rules[0].parameterDefinitions[0]
  f.battle.configSystem.registerTaggedConfig(conflicting.address, 0.9, [])
  expect(() => pack.parameters.install(f.battle.configSystem)).toThrow('already registered')
  expect(f.battle.configSystem.get(conflicting.address)).toBe(0.9)
  expect(f.battle.configSystem.hasRegisteredConfig('ae:mark-param:["ugc/recovery","ratio"]')).toBe(false)
})

it('accepts host-defined scalar presets while checking edited defaults against their TypeBox contract', () => {
  const trusted = {
    parameterPresets: [
      {
        id: 'game.mode',
        schema: Type.Union([Type.Literal('slow'), Type.Literal('fast')], { default: 'slow' }),
        effectiveSchema: Type.Union([Type.Literal('slow'), Type.Literal('fast')]),
        operations: [ConfigModifierType.override],
      },
    ],
  }
  const data = {
    formatVersion: 1,
    id: 'ugc',
    marks: [{ id: 'ugc/mode', instanceParams: { mode: { presetId: 'game.mode', value: 'fast' } } }],
  }
  const result = compileContentPack(data, trusted)
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.marks[0].createInstance().instanceParams).toEqual({ mode: 'fast' })
  data.marks[0].instanceParams.mode.value = 'arbitrary'
  expect(compileContentPack(data, trusted).ok).toBe(false)
})

it('bounds malformed candidates before recursive normalization', () => {
  const deep: Record<string, unknown> = {},
    cycle: Record<string, unknown> = {}
  let cursor = deep
  for (let i = 0; i < 45; i++) {
    const next = {}
    cursor.child = next
    cursor = next
  }
  cycle.self = cycle
  for (const data of [
    deep,
    cycle,
    { ...input(), extra: 'x'.repeat(1048577) },
    { ...input(), marks: Array(65).fill(input().marks[0]) },
  ])
    expect(compileContentPack(data).ok).toBe(false)
})

it('restores a skill-created mark using an independently recompiled saved pack', async () => {
  const f = scenario()
  const catalog = (pack: ReturnType<typeof compile>) => {
    const result = new SnapshotCatalog('ugc-pack/1')
    for (const mark of pack.marks) result.registerContent(mark.id, mark)
    for (const rule of pack.rules) result.registerEffect(rule.effect.id, rule.effect)
    for (const pet of [...f.a.team, ...f.b.team])
      for (const skill of pet.skills)
        for (const effect of [...skill.base.effects, ...skill.effects])
          if (!pack.rules.some(rule => rule.effect.id === effect.id)) result.registerEffect(effect.id, effect)
    for (const effect of f.debuff.effects) result.registerEffect(effect.id, effect)
    return result
  }
  const ready = new Promise<void>(resolve =>
    f.battle.registerListener(message => {
      if (message.type === BattleMessageType.TurnAction) resolve()
    }),
  )
  const run = f.battle.startBattle().catch(error => expect(error.message).toBe('Battle cancelled'))
  await ready
  f.apply()
  const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalog(f.pack))))
  await f.battle.cleanup()
  await run
  const fresh = compile(JSON.parse(JSON.stringify(f.pack.data)))
  const restored = restoreBattle(saved, catalog(fresh))
  battles.push(restored)
  const owner = restored.playerA.activePet
  expect(owner.marks[0].base).toBe(fresh.marks[0])
  owner.currentHp = 1
  restored.applyEffects(new TurnContext(restored), EffectTrigger.TurnEnd)
  expect(owner.currentHp).toBe(1 + Math.floor(owner.stat.maxHp * 0.2))
})

it('resolves cross-mark actions before compiling rules and keeps declared effect order', () => {
  const data = input()
  data.marks.push({
    id: 'ugc/child',
    instanceParams: { ratio: { presetId: 'core.ratio', value: 0 } },
    effects: ['ugc/child/tick'],
  })
  data.markActions.push({ id: 'ugc/child/apply', markId: 'ugc/child', target: 'ownerPet' })
  const childTick = structuredClone(data.rules[1])
  childTick.rule.id = 'ugc/child/tick'
  childTick.rule.sourceMarkId = 'ugc/child'
  data.rules.push(childTick)
  const parentApply = structuredClone(data.rules[1])
  parentApply.rule.id = 'ugc/recovery/child'
  parentApply.rule.actions = [
    { stepId: 'child', id: 'ugc/child/apply', params: { instanceParams: { ratio: { instanceParameter: 'ratio' } } } },
  ]
  data.rules.push(parentApply)
  data.marks[0].effects.unshift('ugc/recovery/child')
  const pack = compile(data)
  expect(pack.marks[0].effects.map(effect => effect.id)).toEqual(['ugc/recovery/child', 'ugc/recovery/tick'])
  const f = scenario(pack)
  f.apply()
  f.battle.applyEffects(new TurnContext(f.battle), EffectTrigger.TurnEnd)
  const child = f.a.activePet.marks.find(mark => mark.base === pack.marks[1])!
  expect(child.instanceParams?.ratio).toBe(0.2)
})
