import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { Type } from '@sinclair/typebox'
import {
  copyRule,
  compileRule,
  compileContentPack,
  CapabilityRegistry,
  coreCapabilities,
  defineAction,
  ConfigDurationType,
  ConfigModifier,
  ConfigModifierType,
  EffectTrigger,
  parameterAddress,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  setGlobalLogger,
  type Battle,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const registry = new CapabilityRegistry(coreCapabilities.actions, coreCapabilities)
const options = { contentId: 'copy-test', sourceKind: 'skill' as const }
function input() {
  return {
    formatVersion: 1,
    id: 'ugc/original',
    parameters: { amount: { nodeId: 'amount', kind: 'number', value: 10 } },
    trigger: { nodeId: 'hit', id: 'core.selfSkillHit' },
    actions: [
      { stepId: 'first', id: 'core.healOwner', params: { amount: { parameter: 'amount' } } },
      { stepId: 'second', id: 'core.healOwner', params: { amount: { parameter: 'amount' } } },
    ],
  }
}
function use(battle: Battle, f: ReturnType<typeof makeScenario>) {
  const skill = f.a.activePet.skills[0]
  battle.applyEffects(
    new UseSkillContext(new TurnContext(battle), f.a, f.a.activePet, AttackTargetOpinion.opponent, skill),
    EffectTrigger.OnHit,
    skill,
  )
}

it('preserves shared fan-out within each copy while isolating public Config addresses', () => {
  const source = compileRule(input(), registry, options)
  const copy = copyRule(input(), 'ugc/copied', registry, options)
  if (!source.ok || !copy.ok) throw new Error('expected successful compilation')
  const f = makeScenario(221)
  battles.push(f.battle)
  source.parameters.install(f.battle.configSystem)
  copy.parameters.install(f.battle.configSystem)
  const skill = f.a.activePet.skills[0]
  skill.effects.splice(0, skill.effects.length, source.effect, copy.effect)
  const from = parameterAddress('ugc/original', 'amount', 'amount')
  const to = parameterAddress('ugc/copied', 'amount', 'amount')
  expect(copy.parameterRemap).toEqual([{ from, to }])
  source.parameters.modify(
    f.battle.configSystem,
    from,
    new ConfigModifier(ConfigDurationType.binding, 'original-only', 5, ConfigModifierType.delta, 0),
    skill,
  )
  f.a.activePet.currentHp = 1
  use(f.battle, f)
  expect(f.a.activePet.currentHp).toBe(51) // 15 + 15 + 10 + 10
  copy.parameters.modify(
    f.battle.configSystem,
    to,
    new ConfigModifier(ConfigDurationType.binding, 'copy-only', 2, ConfigModifierType.delta, 0),
    skill,
  )
  f.a.activePet.currentHp = 1
  use(f.battle, f)
  expect(f.a.activePet.currentHp).toBe(55) // 15 + 15 + 12 + 12
  expect(copy.rule.actions.map(action => action.params)).toEqual(source.rule.actions.map(action => action.params))
  expect(copy.rule.parameters).toEqual(source.rule.parameters)
  expect(source.rule.id).toBe('ugc/original')
})

it('preserves condition and probability references and stable local node identities', () => {
  const rule = {
    ...input(),
    parameters: {
      ...input().parameters,
      chance: { nodeId: 'chance-value', kind: 'number', value: 100 },
      threshold: { nodeId: 'threshold-value', kind: 'number', value: 0.5 },
    },
    when: {
      nodeId: 'all',
      kind: 'all',
      conditions: [
        { nodeId: 'low', id: 'core.ownerHpBelowRatio', params: { ratio: { parameter: 'threshold' } } },
        {
          nodeId: 'not',
          kind: 'not',
          condition: { nodeId: 'zero', id: 'core.ownerHpBelowRatio', params: { ratio: 0 } },
        },
      ],
    },
    roll: { nodeId: 'roll', percent: { parameter: 'chance' } },
  }
  const source = compileRule(rule, registry, options)
  const copy = copyRule(rule, 'ugc/copy', registry, options)
  if (!source.ok || !copy.ok) throw new Error('expected successful compilation')
  expect(copy.rule).toEqual({ ...source.rule, id: 'ugc/copy' })
  expect(copy.parameterRemap).toHaveLength(3)
  const saved = JSON.parse(JSON.stringify(copy.rule))
  const restored = compileRule(saved, registry, options)
  expect(restored.ok).toBe(true)
  if (restored.ok)
    expect(restored.parameterDefinitions.map(definition => definition.address)).toEqual(
      copy.parameterRemap.map(pair => pair.to),
    )
})

it('retains external add-mark capabilities and nested parameter references', () => {
  const packInput = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/examples/ugc-recovery-pack.json', import.meta.url), 'utf8'),
  )
  const pack = compileContentPack(packInput)
  if (!pack.ok) throw new Error('expected pack compilation')
  const copy = copyRule(pack.rules[0].rule, 'ugc/copied-apply', pack.registry, options)
  if (!copy.ok) throw new Error(JSON.stringify(copy.diagnostics))
  expect(copy.rule.actions[0].id).toBe('ugc/recovery/apply')
  expect(copy.rule.actions[0].params).toMatchObject({
    mark: 'ugc/recovery',
    instanceParams: { ratio: { parameter: 'recovery' } },
  })
  const f = makeScenario(222)
  battles.push(f.battle)
  pack.parameters.install(f.battle.configSystem)
  copy.parameters.install(f.battle.configSystem)
  const skill = f.a.activePet.skills[0]
  skill.effects.splice(0, skill.effects.length, copy.effect)
  use(f.battle, f)
  expect(f.a.activePet.marks[0].base).toBe(pack.marks[0])
  expect(f.a.activePet.marks[0].instanceParams?.ratio).toBe(0.2)
})

it('keeps a copied mark rule bound to the same external source definition and instance reader', () => {
  const packInput = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/examples/ugc-recovery-pack.json', import.meta.url), 'utf8'),
  )
  const pack = compileContentPack(packInput)
  if (!pack.ok) throw new Error('expected pack compilation')
  const copy = copyRule(pack.rules[1].rule, 'ugc/copied-tick', pack.registry, {
    contentId: 'mark-copy',
    sourceKind: 'petMark',
    sourceMark: pack.marks[0],
  })
  if (!copy.ok) throw new Error(JSON.stringify(copy.diagnostics))
  expect(copy.rule.sourceMarkId).toBe('ugc/recovery')
  expect(copy.rule.actions[0].params).toEqual({ ratio: { instanceParameter: 'ratio' } })
  expect(copy.parameterRemap).toEqual([])
  const f = makeScenario(223)
  battles.push(f.battle)
  pack.parameters.install(f.battle.configSystem)
  f.a.activePet.skills[0].effects.splice(0, f.a.activePet.skills[0].effects.length, pack.rules[0].effect)
  use(f.battle, f)
  const mark = f.a.activePet.marks[0]
  mark.effects.splice(0, mark.effects.length, copy.effect)
  f.a.activePet.currentHp = 1
  f.battle.applyEffects(new TurnContext(f.battle), EffectTrigger.TurnEnd, mark)
  expect(f.a.activePet.currentHp).toBe(1 + Math.floor(f.a.activePet.stat.maxHp * 0.2))
})

it('never rewrites ordinary strings that happen to equal an old rule or parameter identity', () => {
  const literal = defineAction({
    id: 'echo',
    needs: [],
    params: Type.Object({ text: Type.String() }, { additionalProperties: false }),
    execute() {},
  })
  const echoRegistry = new CapabilityRegistry([literal], coreCapabilities)
  const copy = copyRule(
    { ...input(), actions: [{ stepId: 'echo', id: 'echo', params: { text: 'ugc/original' } }] },
    'ugc/new',
    echoRegistry,
    options,
  )
  if (!copy.ok) throw new Error(JSON.stringify(copy.diagnostics))
  expect(copy.rule.actions[0].params).toEqual({ text: 'ugc/original' })
})

it.each(['same', 'empty', 'invalid-source', 'missing-reference'])(
  'rejects invalid copies without publishing a result: %s',
  kind => {
    const rule = input()
    if (kind === 'invalid-source') rule.actions[0].id = 'unknown'
    if (kind === 'missing-reference') rule.actions[0].params.amount.parameter = 'missing'
    const result = copyRule(rule, kind === 'same' ? rule.id : kind === 'empty' ? '' : 'ugc/new', registry, options)
    expect(result.ok).toBe(false)
    expect(result).not.toHaveProperty('effect')
    expect(result).not.toHaveProperty('parameterRemap')
  },
)

it('publishes a copied mark rule through a new pack candidate and rejects destination collisions', () => {
  const input = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/examples/ugc-recovery-pack.json', import.meta.url), 'utf8'),
  )
  const source = compileContentPack(input)
  if (!source.ok) throw new Error('expected pack compilation')
  const copy = copyRule(source.rules[1].rule, 'ugc/recovery/copied-tick', source.registry, {
    contentId: 'pack-copy',
    sourceKind: 'petMark',
    sourceMark: source.marks[0],
  })
  if (!copy.ok) throw new Error(JSON.stringify(copy.diagnostics))
  const candidate = JSON.parse(JSON.stringify(source.data))
  candidate.rules.push({ sourceKind: 'petMark', rule: copy.rule })
  candidate.marks[0].effects.push(copy.rule.id)
  const published = compileContentPack(candidate)
  if (!published.ok) throw new Error(JSON.stringify(published.diagnostics))
  expect(published.marks[0].effects.map(effect => effect.id)).toEqual(['ugc/recovery/tick', copy.rule.id])
  expect(source.marks[0].effects).toHaveLength(1)
  candidate.rules.push({ sourceKind: 'petMark', rule: copy.rule })
  expect(compileContentPack(candidate)).toMatchObject({ ok: false, diagnostics: [{ code: 'DUPLICATE_ID' }] })
})
