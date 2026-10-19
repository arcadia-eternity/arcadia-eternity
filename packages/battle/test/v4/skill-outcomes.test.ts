import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedSkillOutcomeEffects,
  parameterAddress,
  ConfigModifier,
  ConfigModifierType,
  ConfigDurationType,
  effectAuthoring,
  BaseMark,
  BaseSkill,
  SkillInstance,
  Category,
  Element,
  EffectContext,
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
type Node = Record<string, unknown>
interface Entry {
  id: keyof typeof generatedSkillOutcomeEffects
  sourceFile: string
  definitionSha256: string
  recipe: {
    trigger: 'BeforeUseSkillCheck' | 'AfterUseSkillCheck' | 'BeforeHit'
    operation: 'addAccuracy' | 'addCritRate' | 'setSureHit' | 'setSureMiss' | 'setSureCrit'
    amount?: number
    value?: string
    pathRepairs?: { path: string; before: string; after: string }[]
    repairedPaths: string[]
    orderConditions?: { path: string; type: string }[]
    parameters?: { name: string }[]
  }
}
const records: Entry[] = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/skill-outcomes-candidates.json', import.meta.url), 'utf8'),
).records
const originals = new Map<string, Node>()
for (const file of new Set(records.map(r => r.sourceFile)))
  for (const d of parse(readFileSync(new URL(`../../../../${file}`, import.meta.url), 'utf8'), { merge: true }))
    originals.set(d.id, d)
function corrected(value: unknown, paths: string[] = [], path = ''): unknown {
  if (Array.isArray(value)) return value.map((v, i) => corrected(v, paths, `${path}/${i}`))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        const next = `${path}/${k}`
        if (['base', 'target'].includes(k) && v === 'useSkillContext') {
          paths.push(next)
          return [k, 'usingSkillContext']
        }
        return [k, corrected(v, paths, next)]
      }),
    )
  return value
}
function nodes(value: unknown): Node[] {
  return Array.isArray(value)
    ? value.flatMap(nodes)
    : value && typeof value === 'object'
      ? [value as Node, ...Object.values(value).flatMap(nodes)]
      : []
}
const pathRepairs: Record<string, [string, string, string][]> = {
  effect_emblem_immune_skill_bandao: [['/condition/conditions/1/target/chain/0/arg', 'skillId', 'skill']],
  effect_skill_sure_hit_if_atk_over_500: [['/condition/conditions/1/target/chain/0/arg', 'atk', 'stat.atk']],
  effect_skill_sure_hit_if_opponent_spa_gt_atk: [
    ['/condition/conditions/1/target/chain/0/arg', 'spa', 'stat.spa'],
    ['/condition/conditions/1/evaluator/value/selector/chain/0/arg', 'atk', 'stat.atk'],
  ],
}
function reference(r: Entry) {
  const d = corrected(originals.get(r.id)) as Node
  for (const [path, before, after] of pathRepairs[r.id] ?? []) {
    const parts = path.slice(1).split('/')
    const key = parts.pop()!
    const parent = parts.reduce((n, part) => n[part] as Node, d)
    expect(parent[key]).toBe(before)
    parent[key] = after
  }
  return d
}
const oracles = new Map(records.map(r => [r.id, EffectParser.parse(reference(r))]))
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
import { makeScenario } from './scenario'
const parameterVariants = ['config-zero', 'config-custom', 'foreign-config', 'late-config'] as const
const stackVariants = ['stack-empty', 'stack-one', 'stack-two', 'stack-later', 'stack-first', 'late-stack'] as const
const turnVariants = ['turn-first', 'turn-second'] as const
const orderVariants = ['wrong-order', 'empty-order', 'non-skill-first', 'late-order'] as const
const variants = [
  'normal',
  'wrong-owner',
  'other-skill',
  'late-condition',
  'late-owner',
  'cancel',
  'nested',
  'missing',
  'repeat',
  'phase',
  'negative',
  'late-values',
  'empty-values',
  'late-target',
] as const
function run(
  r: Entry,
  native: boolean,
  kind: 'skill' | 'mark',
  variant:
    | (typeof variants)[number]
    | (typeof parameterVariants)[number]
    | (typeof orderVariants)[number]
    | (typeof turnVariants)[number]
    | (typeof stackVariants)[number],
) {
  const f = makeScenario(301),
    { battle, a, b } = f
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) for (const s of p.skills) s.effects.splice(0)
  const pet = a.activePet,
    skill = new SkillInstance(
      new BaseSkill(
        (r.id === 'effect_emblem_immune_skill_bandao' ? 'skill_bandao' : 'fixture/outcome') as baseSkillId,
        Category.Status,
        Element.Normal,
        1,
        20,
        0,
        0,
        AttackTargetOpinion.opponent,
      ),
    )
  skill.owner = pet
  pet.skills[0] = skill
  const def = originals.get(r.id)!,
    all = nodes(def)
  const supports: typeof pet.marks = []
  const add = (owner: typeof pet | Battle, id: string, tag?: string) => {
    const mark = new BaseMark(
      id as baseMarkId,
      [],
      { ...f.debuff.config, maxStacks: 6, duration: -1 },
      tag ? [tag] : [],
    ).createInstance()
    mark.owner = owner
    mark.stack = 3
    mark.duration = 2
    owner.marks.push(mark)
    supports.push(mark)
    return mark
  }
  for (const n of all) {
    if (
      typeof n.type === 'string' &&
      ['selfHasMark', 'opponentHasMark'].includes(n.type) &&
      typeof n.baseId === 'string'
    ) {
      add(pet, n.baseId)
      add(b.activePet, n.baseId)
    }
    if (n.type === 'same' && typeof n.value === 'string' && n.value.startsWith('mark_')) {
      add(pet, n.value)
      add(b.activePet, n.value)
      if (n.value.startsWith('mark_global_')) add(battle, n.value)
    }
    if (n.type === 'contain' && typeof n.tag === 'string') {
      add(pet, 'fixture/tag', n.tag)
      add(b.activePet, 'fixture/tag', n.tag)
    }
  }
  let source: typeof skill | (typeof pet.marks)[number] = skill
  if (kind === 'mark') source = add(pet, 'fixture/source')
  if (stackVariants.includes(variant as (typeof stackVariants)[number])) {
    const matches = b.activePet.marks.filter(m => m.baseId === 'mark_kongjuzhinian')
    if (variant === 'stack-empty') b.activePet.marks = b.activePet.marks.filter(m => !matches.includes(m))
    if (variant === 'stack-one' || variant === 'stack-later')
      matches.forEach(m => {
        m.stack = 1
      })
    if (variant === 'stack-two')
      matches.forEach(m => {
        m.stack = 2
      })
    if (variant === 'stack-later' || variant === 'stack-first') {
      const extra = add(b.activePet, 'mark_kongjuzhinian')
      extra.stack = variant === 'stack-later' ? 3 : 1
    }
  }
  source.effects.push(native ? generatedSkillOutcomeEffects[r.id] : oracles.get(r.id)!)
  if (native) effectAuthoring.effectParameters(generatedSkillOutcomeEffects[r.id]).install(battle.configSystem)
  const other = new SkillInstance(skill.base)
  other.owner = pet
  const selected = variant === 'other-skill' ? other : skill
  const turn = new TurnContext(battle)
  let use = new UseSkillContext(turn, a, pet, AttackTargetOpinion.opponent, selected)
  const rival = new UseSkillContext(turn, b, b.activePet, AttackTargetOpinion.opponent, b.activePet.skills[0])
  if (r.recipe.orderConditions && !variant.startsWith('turn-')) {
    turn.appledContexts.push(
      ...(variant === 'empty-order' ? [] : variant === 'wrong-order' ? [rival, use] : [use, rival]),
    )
    if (variant === 'non-skill-first')
      turn.appledContexts.unshift(new EffectContext(turn, EffectTrigger.BeforeEffect, source))
  }
  use.updateActualTarget()
  use.accuracy = 20
  use.critRate = 10
  pet.attributeSystem.updateBaseValue('atk', 600)
  b.activePet.attributeSystem.updateBaseValue('spa', 200)
  b.activePet.attributeSystem.updateBaseValue('atk', 100)
  pet.lastSkillUsedTimes = 3
  pet.lastSkill = selected
  // These legacy selectors read public optional/raw fields rather than stat attributes.
  Object.defineProperties(pet, { height: { value: 200, configurable: true }, level: { value: 60, configurable: true } })
  Object.defineProperty(b.activePet, 'level', { value: 50, configurable: true })
  pet.currentHp = 1
  b.activePet.currentHp = 1
  function skillFields(v: unknown, inverted = false) {
    if (!v || typeof v !== 'object') return
    const n = v as Node
    if (n.type === 'not') {
      skillFields(n.condition, !inverted)
      return
    }
    if (n.type === 'evaluate') {
      const target = n.target as { base?: string; chain?: { arg?: unknown }[] },
        ev = n.evaluator as { value?: unknown }
      if (target?.base === 'useSkillContext') {
        const arg = target.chain?.[0]?.arg
        const name = typeof arg === 'string' ? arg : (arg as { arg?: string })?.arg
        if (name === 'element') use.element = ev.value as Element
        if (name === 'category') use.category = inverted ? Category.Physical : (ev.value as Category)
      }
    }
    for (const child of Object.values(n)) if (Array.isArray(child)) child.forEach(c => skillFields(c, inverted))
  }
  skillFields(def.condition)
  const removeSupports = () => {
    for (const owner of [pet, b.activePet, battle])
      owner.marks = owner.marks.filter(m => !supports.includes(m) || m === source)
  }
  const mismatch = () => {
    if (r.recipe.orderConditions) turn.appledContexts.splice(0, turn.appledContexts.length, rival, use)
    removeSupports()
    pet.attributeSystem.updateBaseValue('atk', 500)
    b.activePet.attributeSystem.updateBaseValue('spa', 100)
    if (r.id === 'effect_emblem_immune_skill_bandao')
      use.skill = new SkillInstance(
        new BaseSkill(
          'fixture/other' as baseSkillId,
          Category.Status,
          Element.Normal,
          1,
          20,
          0,
          0,
          AttackTargetOpinion.opponent,
        ),
      )
    pet.currentHp = pet.stat.maxHp
    b.activePet.currentHp = b.activePet.stat.maxHp
    use.element = Element.Normal
    use.category = use.category === Category.Status ? Category.Physical : Category.Status
    pet.lastSkillUsedTimes = 1
    pet.attributeSystem.updateBaseValue('maxHp', 1)
    Object.defineProperties(pet, { height: { value: 1, configurable: true }, level: { value: 1, configurable: true } })
  }
  if (variant === 'negative') mismatch()
  if (variant === 'wrong-owner') source.owner = a.team[1]
  const configure = (amount: number, foreign = false) => {
    for (const p of r.recipe.parameters ?? []) {
      const keys = battle.configSystem.getRegisteredKeys().filter(key => key.startsWith(`${r.id}.`))
      if (!native && keys.length !== 1) throw new Error('Ambiguous anonymous parameter oracle')
      const key = native ? parameterAddress(r.id, 'parameters', p.name) : keys[0]
      battle.configSystem.addScopedConfigModifier(
        key,
        new ConfigModifier(
          ConfigDurationType.binding,
          'fixture/outcome-config',
          amount,
          ConfigModifierType.override,
          0,
        ),
        foreign ? b.activePet.skills[0] : source,
      )
    }
  }
  if (variant === 'config-zero') configure(0)
  if (variant === 'config-custom') configure(7.5)
  if (variant === 'foreign-config') configure(0, true)
  const applied: number[] = []
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/outcome-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === r.id,
      apply(c) {
        applied.push(pet.lastSkillUsedTimes)
        if (variant === 'late-stack')
          supports.forEach(m => {
            m.stack = 1
          })
        if (variant === 'late-order') turn.appledContexts.splice(0, turn.appledContexts.length, rival, use)
        if (variant === 'late-config') configure(7.5)
        if (variant === 'late-condition') mismatch()
        if (variant === 'late-owner') source.owner = a.team[1]
        if (variant === 'cancel' && c.parent instanceof EffectContext) c.parent.available = false
        if (variant === 'late-values') {
          pet.lastSkillUsedTimes = 2
          supports.forEach(m => {
            m.stack = 1
            m.duration = 1
          })
        }
        if (variant === 'empty-values') removeSupports()
        if (variant === 'late-target') use.actualTarget = b.team[1]
      },
    }),
  )
  if (variant === 'turn-first' || variant === 'turn-second') {
    battle.skillMap.set(skill.id, skill)
    const harmless = new SkillInstance(skill.base)
    harmless.owner = b.activePet
    b.activePet.skills[0] = harmless
    battle.skillMap.set(harmless.id, harmless)
    let reached = 0
    skill.effects.push(
      defineNativeEffect({
        id: 'fixture/outcome-turn-stage' as effectId,
        triggers: [EffectTrigger[r.recipe.trigger]],
        when: c => c.parent instanceof UseSkillContext && c.parent.skill === skill,
        apply() {
          reached++
        },
      }),
    )
    for (const player of [a, b]) {
      player.currentRage = player.maxRage
      player.activePet.attributeSystem.updateBaseValue(
        'spe',
        player === a ? (variant === 'turn-first' ? 200 : 50) : 100,
      )
      player.activePet.attributeSystem.updateBaseValue('critRate', 10)
      const chosen = player.activePet.skills[0]
      player.selection = { player: player.id, type: 'use-skill', skill: chosen.id, target: chosen.target }
    }
    // Reach BeforeHit without making this fixture's assertions depend on hit RNG.
    skill.effects.push(
      defineNativeEffect({
        id: 'fixture/outcome-turn-hit' as effectId,
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        when: c => c.parent instanceof UseSkillContext && c.parent.skill === skill,
        apply(c) {
          if (c.parent instanceof UseSkillContext) c.parent.hitOverrides.push({ willHit: true, priority: 1000 })
        },
      }),
    )
    executeTurnOperation(turn, battle)
    expect(reached).toBe(1)
    const executed = turn.appledContexts.filter((c): c is UseSkillContext => c instanceof UseSkillContext)
    expect(executed.map(c => c.pet)).toEqual(variant === 'turn-first' ? [pet, b.activePet] : [b.activePet, pet])
    use = executed.find(c => c.pet === pet)!
  } else if (variant === 'phase') {
    a.currentRage = a.maxRage
    if (r.recipe.trigger === 'BeforeHit') use.hitOverrides.push({ willHit: true, priority: 1000 })
    use.rage = 0
    const phase = new SkillPhase(battle, a, pet, AttackTargetOpinion.opponent, selected, turn, use)
    phase.initialize()
    phase.execute()
  } else {
    const event =
      variant === 'missing'
        ? turn
        : variant === 'nested'
          ? new EffectContext(use, EffectTrigger.BeforeEffect, source)
          : use
    battle.applyEffects<EffectTrigger>(event, EffectTrigger[r.recipe.trigger], source)
    if (variant === 'repeat') battle.applyEffects(use, EffectTrigger[r.recipe.trigger], source)
    use.updateHitResult()
    use.updateCritResult()
  }
  return {
    applied,
    accuracy: use.accuracy,
    critRate: use.critRate,
    hitOverrides: use.hitOverrides,
    critOverrides: use.critOverrides,
    hit: use.hitResult,
    crit: use.crit,
    next: battle.random(),
  }
}
for (const r of records) {
  it(`${r.id} pins source and exact spelling correction`, () => {
    expect(() => EffectParser.parse(originals.get(r.id))).toThrow()
    const paths: string[] = []
    corrected(originals.get(r.id), paths)
    expect(paths).toEqual(r.recipe.repairedPaths)
    expect(r.recipe.pathRepairs ?? []).toEqual(
      (pathRepairs[r.id] ?? []).map(([path, before, after]) => ({ path, before, after })),
    )
    const normalize = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(normalize)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.entries(v)
                .sort(([a], [b]) => a.localeCompare(b, 'en'))
                .map(([k, v]) => [k, normalize(v)]),
            )
          : v
    expect(
      createHash('sha256')
        .update(JSON.stringify(normalize(originals.get(r.id))))
        .digest('hex'),
    ).toBe(r.definitionSha256)
  })
  if (nodes(originals.get(r.id)?.condition).some(n => n.type === 'opponentUseSkill')) continue
  for (const kind of ['skill', 'mark'] as const)
    it.each(variants)(`${r.id} ${kind}: %s`, variant => {
      const actual = run(r, true, kind, variant)
      expect(actual).toEqual(run(r, false, kind, variant))
      if (
        ['normal', 'late-condition', 'late-owner', 'late-values', 'empty-values', 'late-target', 'phase'].includes(
          variant,
        )
      )
        expect(actual.applied).toHaveLength(1)
      if (['wrong-owner', 'missing'].includes(variant)) expect(actual.applied).toHaveLength(0)
      if (
        variant === 'negative' &&
        nodes(originals.get(r.id)?.condition).some(
          n => typeof n.type === 'string' && !['every', 'selfUseSkill', 'checkSelf'].includes(n.type),
        )
      )
        expect(actual.applied).toHaveLength(0)
      if (variant === 'normal') {
        const amount = r.recipe.amount ?? (r.id.includes('ruodian') ? 135 : r.id.includes('usetime') ? 60 : 50)
        if (r.recipe.operation === 'addAccuracy') expect(actual.accuracy).toBe(Math.min(100, 20 + amount))
        if (r.recipe.operation === 'addCritRate') expect(actual.critRate).toBe(Math.min(100, 10 + amount))
        if (r.recipe.operation === 'setSureHit' || r.recipe.operation === 'setSureMiss')
          expect(actual.hitOverrides).toEqual([{ willHit: r.recipe.operation === 'setSureHit', priority: amount }])
        if (r.recipe.operation === 'setSureCrit')
          expect(actual.critOverrides).toEqual([{ willCrit: true, priority: amount }])
      }
    })
}
it('audits complete generated outcome ID coverage', () =>
  expect(Object.keys(generatedSkillOutcomeEffects).sort()).toEqual(records.map(r => r.id).sort()))

for (const r of records.filter(r => r.recipe.parameters))
  for (const kind of ['skill', 'mark'] as const)
    it.each(parameterVariants)(`${r.id} ${kind} parameter: %s`, variant => {
      const actual = run(r, true, kind, variant)
      expect(actual).toEqual(run(r, false, kind, variant))
      expect(actual.applied).toHaveLength(1)
      const amount = variant === 'config-zero' ? 0 : variant === 'foreign-config' ? 50 : 15
      expect(r.recipe.operation === 'addAccuracy' ? actual.accuracy : actual.critRate).toBe(
        (r.recipe.operation === 'addAccuracy' ? 20 : 10) + amount,
      )
    })

for (const r of records.filter(r => r.recipe.orderConditions))
  for (const kind of ['skill', 'mark'] as const)
    it.each(orderVariants)(`${r.id} ${kind} order: %s`, variant => {
      const actual = run(r, true, kind, variant)
      expect(actual).toEqual(run(r, false, kind, variant))
      const admitted = variant === 'non-skill-first' || variant === 'late-order'
      expect(actual.applied).toHaveLength(admitted ? 1 : 0)
      if (r.recipe.operation === 'addCritRate') expect(actual.critRate).toBe(10 + (admitted ? r.recipe.amount! : 0))
      else
        expect(r.recipe.operation === 'setSureHit' ? actual.hitOverrides : actual.critOverrides).toHaveLength(
          admitted ? 1 : 0,
        )
    })

for (const r of records.filter(r => r.recipe.orderConditions))
  for (const kind of ['skill', 'mark'] as const)
    it.each(turnVariants)(`${r.id} ${kind} real turn: %s`, variant => {
      const actual = run(r, true, kind, variant)
      expect(actual).toEqual(run(r, false, kind, variant))
      const admitted = variant === 'turn-first'
      expect(actual.applied).toHaveLength(admitted ? 1 : 0)
      if (r.recipe.operation === 'addCritRate') expect(actual.critRate).toBe(10 + (admitted ? r.recipe.amount! : 0))
      if (r.recipe.operation === 'setSureCrit')
        expect(actual.critOverrides).toEqual(admitted ? [{ willCrit: true, priority: r.recipe.amount }] : [])
      if (r.recipe.operation === 'setSureHit')
        expect(actual.hitOverrides.filter(x => x.priority !== 1000)).toEqual(
          admitted ? [{ willHit: true, priority: r.recipe.amount }] : [],
        )
    })

for (const kind of ['skill', 'mark'] as const)
  it.each(stackVariants)(`effect_skill_sure_crit_if_opponent_has_2_kongjuzhinian ${kind} stack: %s`, variant => {
    const r = records.find(r => r.id === 'effect_skill_sure_crit_if_opponent_has_2_kongjuzhinian')!
    const actual = run(r, true, kind, variant)
    expect(actual).toEqual(run(r, false, kind, variant))
    const admitted = !['stack-empty', 'stack-one'].includes(variant)
    expect(actual.applied).toHaveLength(admitted ? 1 : 0)
    expect(actual.critOverrides).toEqual(admitted ? [{ willCrit: true, priority: 1 }] : [])
  })
