import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedVitalSequences,
  BaseMark,
  BaseSkill,
  SkillInstance,
  AttributeSystem,
  Category,
  Element,
  EffectContext,
  RemoveMarkContext,
  DamageContext,
  effectAuthoring,
  parameterAddress,
  HealContext,
  RageContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  SkillPhase,
  executeTurnOperation,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type baseSkillId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
interface RecordEntry {
  id: keyof typeof generatedVitalSequences
  sourceFile: string
  definitionSha256: string
  recipe: {
    trigger: 'OnHit'
    repairedPaths: string[]
    valueRepairs?: { path: string; before: string; after: string }[]
    pathRepairs?: { path: string; before: string; after: string }[]
    parameters?: { name: string; value: number }[]
    actions: { sourcePath: string }[]
  }
}
const records: RecordEntry[] = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/vital-sequences-candidates.json', import.meta.url), 'utf8'),
).records.filter((r: RecordEntry) => r.recipe.trigger === 'OnHit')
interface Definition {
  id: string
  apply: unknown[]
  condition: { conditions: { target: { chain: { arg: string }[] } }[] }
}
const definitions = new Map<string, Definition>()
for (const file of new Set(records.map(r => r.sourceFile)))
  for (const d of parse(readFileSync(new URL(`../../../../${file}`, import.meta.url), 'utf8'), { merge: true }))
    definitions.set(d.id, d)
function copy(value: unknown, paths: string[] = [], path = ''): unknown {
  if (Array.isArray(value)) return value.map((v, i) => copy(v, paths, `${path}/${i}`))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        const next = `${path}/${k}`
        if (['base', 'target'].includes(k) && v === 'useSkillContext') {
          paths.push(next)
          return [k, 'usingSkillContext']
        }
        return [k, copy(v, paths, next)]
      }),
    )
  return value
}
function reference(r: RecordEntry) {
  return copy(definitions.get(r.id)) as Definition
}
const oracles = new Map(records.map(r => [r.id, EffectParser.parse(reference(r))]))
const battles: Battle[] = []
let baselineInstances = 0
beforeEach(() => {
  baselineInstances = AttributeSystem.getGlobalMemoryStats().totalInstances
})
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baselineInstances)
})
const variants = [
  'normal',
  'missing-support',
  'late-support',
  'late-owner',
  'late-target',
  'late-stack',
  'cancel',
  'one-layer',
  'nested',
  'phase',
  'turn',
  'value-redirect',
  'multi-mark',
  'repeat',
  'redirect',
  'switch-slot',
] as const
function run(
  r: RecordEntry,
  native: boolean,
  kind: 'skill' | 'mark',
  variant: (typeof variants)[number] | 'config-custom' | 'config-zero' | 'late-config',
  seed = 421,
) {
  const { battle, a, b, debuff } = makeScenario(seed)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) for (const s of p.skills) s.effects.splice(0)
  const skill = new SkillInstance(
    new BaseSkill(
      'fixture/sequence' as baseSkillId,
      Category.Status,
      Element.Normal,
      100,
      50,
      0,
      0,
      AttackTargetOpinion.opponent,
    ),
  )
  skill.setOwner(a.activePet)
  a.activePet.skills[0] = skill
  battle.skillMap.set(skill.id, skill)
  const support: typeof a.activePet.marks = []
  const add = (owner: typeof a.activePet, id: string, stack = 3) => {
    const mark = new BaseMark(id as baseMarkId, [], { ...debuff.config, maxStacks: 300, duration: -1 }).createInstance()
    mark.setOwner(owner, battle.emitter)
    mark.stack = stack
    owner.marks.push(mark)
    return mark
  }
  const sourceMark = add(
    a.activePet,
    'fixture/source',
    ['one-layer', 'redirect', 'switch-slot'].includes(variant) ? 1 : 3,
  )
  for (const p of [...a.team, ...b.team]) {
    p.attributeSystem.updateBaseValue('maxHp', 2001)
    p.currentHp = 1000
  }
  a.currentRage = 20
  b.currentRage = 20
  const vitals = () => ({ hp: [...a.team, ...b.team].map(p => p.currentHp), rage: [a.currentRage, b.currentRage] })
  const initial = vitals()
  const source = kind === 'mark' ? sourceMark : skill
  const supportId = r.id.includes('yinbo')
    ? 'mark_yinbo'
    : r.id.includes('dongqifuti')
      ? 'mark_dongqifuti'
      : r.id.includes('jishengzhadan')
        ? 'mark_jishengzhadan'
        : 'mark_shaoshang'
  if (supportId)
    for (const owner of [a.activePet, b.activePet]) {
      support.push(add(owner, supportId, ['one-layer', 'redirect', 'switch-slot'].includes(variant) ? 1 : 3))
      if (variant === 'multi-mark') support.push(add(owner, supportId, 2))
    }
  const clearSupports = () => {
    for (const owner of [a.activePet, b.activePet]) owner.marks = owner.marks.filter(m => !support.includes(m))
  }
  if (variant === 'missing-support') clearSupports()
  const effect = native ? generatedVitalSequences[r.id] : oracles.get(r.id)!
  if (native) effectAuthoring.effectParameters(effect).install(battle.configSystem)
  const configure = (value: number) => {
    for (const p of r.recipe.parameters ?? []) {
      const keys = battle.configSystem.getRegisteredKeys().filter(k => k.startsWith(`${r.id}.`))
      if (!native) expect(keys).toHaveLength(1)
      battle.configSystem.set(native ? parameterAddress(r.id, 'parameters', p.name) : keys[0], value)
    }
  }
  if (variant === 'config-custom') configure(3.5)
  if (variant === 'config-zero') configure(0)
  source.effects.push(effect)
  const turn = new TurnContext(battle)
  let use = new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, skill)
  use.updateActualTarget()
  use.power = 100
  use.accuracy = 50
  use.critRate = 10
  let outer: EffectContext<EffectTrigger> | undefined
  const admitted: number[] = []
  const destruction: { id: string; vitals: ReturnType<typeof vitals> }[] = []
  for (const mark of [sourceMark, ...support])
    mark.effects.push(
      defineNativeEffect({
        id: `fixture/destroy-${mark.id}` as effectId,
        triggers: [EffectTrigger.OnMarkDestroy],
        apply(c) {
          if (!(c.parent instanceof RemoveMarkContext) || c.parent.parent !== outer) return
          destruction.push({
            id: mark.baseId,
            vitals: vitals(),
          })
          if (variant === 'redirect') use.actualTarget = b.team[1]
          if (variant === 'switch-slot') b.activePet = b.team[1]
        },
      }),
    )
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/sequence-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === r.id,
      apply(c) {
        outer = c.parent as EffectContext<EffectTrigger>
        if (variant === 'turn' && outer.parent instanceof UseSkillContext) use = outer.parent
        admitted.push(sourceMark.stack)
        if (variant === 'late-support') clearSupports()
        if (variant === 'late-owner') source.owner = a.team[1]
        if (variant === 'late-target') use.actualTarget = b.team[1]
        if (variant === 'late-stack') for (const mark of support) mark.stack = 7
        if (variant === 'late-config') configure(3.5)
        if (variant === 'cancel') outer.available = false
      },
    }),
  )
  const valueTrace: { type: string; value: number }[] = []
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/value-observer' as effectId,
      triggers: [EffectTrigger.OnHeal, EffectTrigger.OnDamage, EffectTrigger.OnRageGain],
      when: c =>
        (c.parent instanceof HealContext || c.parent instanceof DamageContext || c.parent instanceof RageContext) &&
        c.parent.parent === outer,
      apply(c) {
        const event = c.parent
        if (event instanceof HealContext) valueTrace.push({ type: 'heal', value: event.healResult })
        if (event instanceof DamageContext) valueTrace.push({ type: 'damage', value: event.damageResult })
        if (event instanceof RageContext) valueTrace.push({ type: 'rage', value: event.value })
        if (variant === 'value-redirect') use.actualTarget = b.team[1]
      },
    }),
  )
  if (variant === 'phase' || variant === 'turn') {
    let reached = 0
    skill.effects.push(
      defineNativeEffect({
        id: 'fixture/sequence-stage' as effectId,
        triggers: [EffectTrigger[r.recipe.trigger]],
        when: c => c.parent instanceof UseSkillContext && c.parent.skill === skill,
        apply() {
          reached++
        },
      }),
    )
    skill.effects.push(
      defineNativeEffect({
        id: 'fixture/sequence-hit' as effectId,
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        when: c => c.parent instanceof UseSkillContext && c.parent.skill === skill,
        apply(c) {
          if (c.parent instanceof UseSkillContext) c.parent.hitOverrides.push({ willHit: true, priority: 1000 })
        },
      }),
    )
    a.currentRage = a.maxRage
    if (variant === 'phase') {
      const p = new SkillPhase(battle, a, a.activePet, AttackTargetOpinion.opponent, skill, turn, use)
      p.initialize()
      p.execute()
    } else {
      a.selection = { player: a.id, type: 'use-skill', skill: skill.id, target: skill.target }
      b.selection = { player: b.id, type: 'do-nothing' }
      executeTurnOperation(turn, battle)
      use = turn.appledContexts.find((c): c is UseSkillContext => c instanceof UseSkillContext)!
    }
    expect(reached).toBe(1)
  } else {
    const event = use
    const parent = variant === 'nested' ? new EffectContext(event, EffectTrigger.BeforeEffect, source) : event
    battle.applyEffects<EffectTrigger>(parent, EffectTrigger[r.recipe.trigger], source)
    if (variant === 'repeat') battle.applyEffects<EffectTrigger>(parent, EffectTrigger[r.recipe.trigger], source)
  }
  const state = (event: UseSkillContext) => ({
    power: event.power,
    accuracy: event.accuracy,
    critRate: event.critRate,
    hit: event.hitOverrides,
    crit: event.critOverrides,
  })
  return {
    admitted,
    destruction,
    source: { stack: sourceMark.stack, active: sourceMark.isActive },
    support: support.map(m => ({ id: m.baseId, stack: m.stack, active: m.isActive })),
    use: state(use),
    vitals: vitals(),
    valueTrace,
    initial,
    next: battle.random(),
  }
}

for (const r of records) {
  it(`${r.id} audits full source`, () => {
    expect(r.recipe.repairedPaths).toEqual([])
    expect(r.recipe.actions.map(a => a.sourcePath)).toEqual(definitions.get(r.id)!.apply.map((_, i) => `/apply/${i}`))
    const normalize = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(normalize)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .map(k => [k, normalize((v as Record<string, unknown>)[k])]),
            )
          : v
    expect(
      createHash('sha256')
        .update(JSON.stringify(normalize(definitions.get(r.id))))
        .digest('hex'),
    ).toBe(r.definitionSha256)
  })
  for (const kind of ['skill', 'mark'] as const)
    for (const variant of variants)
      it(`${r.id} ${kind} ${variant}`, () => {
        const actual = run(r, true, kind, variant)
        expect(actual).toEqual(run(r, false, kind, variant))
        if (variant === 'normal') {
          expect(actual.admitted).toHaveLength(1)
          expect(actual.destruction).toHaveLength(1)
          const amount = r.id.includes('jishengzhadan')
            ? 300
            : r.id.includes('shaoshang')
              ? 150
              : r.id.includes('dongqifuti')
                ? 500
                : r.id.includes('rage')
                  ? 3
                  : 6
          const type = r.id.includes('heal') ? 'heal' : r.id.includes('rage') ? 'rage' : 'damage'
          expect(actual.valueTrace).toEqual([{ type, value: amount }])
          if (type === 'heal') expect(actual.vitals.hp[0]).toBe(1000 + amount)
          if (type === 'damage') expect(actual.vitals.hp[2]).toBe(1000 - amount)
          if (type === 'rage') expect(actual.vitals.rage[0]).toBe(23)
          if (r.id.includes('ignite')) expect(actual.destruction[0].vitals.hp[2]).toBe(1000)
          else expect(actual.destruction[0].vitals).toEqual(actual.vitals)
        }
        if (variant === 'cancel') {
          expect(actual.valueTrace).toEqual([])
          expect(actual.destruction).toEqual([])
        }
        if (variant === 'late-stack' && r.id.includes('yinbo'))
          expect(actual.valueTrace[0].value).toBe(r.id.includes('rage') ? 7 : 14)
        if (variant === 'value-redirect' && !r.id.includes('ignite')) {
          expect(actual.valueTrace).toHaveLength(1)
          expect(actual.destruction).toEqual([])
        }
        if (variant === 'switch-slot' && r.id.includes('ignite')) {
          expect(actual.vitals.hp[2]).toBe(1000)
          expect(actual.vitals.hp[3]).toBe(r.id.includes('jishengzhadan') ? 700 : 850)
        }
      })
}
it('exports exactly the vital sequence ledger', () =>
  expect(
    Object.keys(generatedVitalSequences)
      .filter(id => records.some(r => r.id === id))
      .sort(),
  ).toEqual(records.map(r => r.id).sort()))

for (const r of records.filter(r => r.recipe.parameters?.length))
  for (const kind of ['skill', 'mark'] as const)
    for (const variant of ['config-custom', 'config-zero', 'late-config'] as const)
      it(`${r.id} ${kind} ${variant}`, () => {
        const actual = run(r, true, kind, variant)
        expect(actual).toEqual(run(r, false, kind, variant))
        const amount = variant === 'config-zero' ? 0 : 10
        expect(actual.vitals.hp[r.id.includes('heal') ? 0 : 2]).toBe(1000 + (r.id.includes('heal') ? amount : -amount))
        expect(actual.destruction).toHaveLength(1)
      })
