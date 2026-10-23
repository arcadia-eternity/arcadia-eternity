import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, Operators } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  BaseMark,
  BaseSkill,
  SkillInstance,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  SkillPhase,
  Category,
  Element,
  AttackTargetOpinion,
  defineNativeEffect,
  setGlobalLogger,
  parameterAddress,
  executeTurnOperation,
  ConfigModifierType,
  ConfigDurationType,
  type Battle,
  type baseMarkId,
  type baseSkillId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { generatedMultihit } from '@arcadia-eternity/data-pack-base/native'

type Id = keyof typeof generatedMultihit
const ledger = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/multihit-candidates.json', import.meta.url), 'utf8'),
)
const ids = Object.keys(generatedMultihit) as Id[]
const originals = new Map(
  ids.map(id => {
    const r = ledger.records.find((r: { id: string }) => r.id === id)
    return [
      id,
      parse(readFileSync(new URL(`../../../../${r.sourceFile}`, import.meta.url), 'utf8'), { merge: true })[
        Number(r.sourcePath.slice(1))
      ],
    ]
  }),
)
function correct(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(correct)
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [
        k,
        ['base', 'target'].includes(k) && x === 'useSkillContext' ? 'usingSkillContext' : correct(x),
      ]),
    )
  return v
}
const oracles = new Map(
  ids.map(id => {
    const d = correct(originals.get(id)) as ReturnType<typeof parse>
    if (id === 'effect_mark_shuangrenzhan_add_2_hits' || id === 'effect_mark_shuangpozhan_add_2_hits') {
      expect(d.condition.conditions[1].target.chain[0].arg).toBe('skillId')
      d.condition.conditions[1].target.chain[0].arg = 'skill'
    }
    return [id, EffectParser.parse(d)]
  }),
)
const battles: Battle[] = [],
  errors: unknown[][] = []
beforeAll(() =>
  setGlobalLogger({
    debug() {},
    info() {},
    warn() {},
    error(...args) {
      errors.push(args)
    },
  }),
)
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
  expect(errors.splice(0)).toEqual([])
})
const variants = [
  'normal',
  'empty',
  'late-value',
  'late-target',
  'late-owner',
  'cancel',
  'wrong-role',
  'wrong-skill',
  'wrong-order',
  'empty-order',
  'nested',
  'repeat',
  'phase',
  'miss',
] as const
function run(
  id: Id,
  native: boolean,
  kind: 'skill' | 'mark',
  variant: (typeof variants)[number] | 'turn-first' | 'turn-second',
  options: {
    counts?: number[]
    uses?: number
    roll?: number
    percent?: number
    initial?: number
    tagPercent?: number
    sourceStack?: number
  } = {},
) {
  const { battle, a, b, debuff } = makeScenario(1601)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) for (const s of p.skills) s.effects.splice(0)
  const d = originals.get(id)!,
    defensive = id.startsWith('effect_mark_shuang')
  const skillId =
    variant === 'wrong-skill'
      ? 'fixture/wrong'
      : id.includes('shuangrenzhan')
        ? 'skill_shuangrenzhan'
        : id.includes('shuangpozhan')
          ? 'skill_shuangpozhan'
          : 'fixture/multihit'
  const skill = new SkillInstance(
    new BaseSkill(
      skillId as baseSkillId,
      Category.Status,
      Element.Normal,
      0,
      100,
      0,
      0,
      AttackTargetOpinion.opponent,
      1,
      true,
    ),
  )
  skill.setOwner(a.activePet)
  a.activePet.skills[0] = skill
  battle.skillMap.set(skill.id, skill)
  const owner = defensive ? b.activePet : a.activePet
  const mark = new BaseMark('fixture/multihit-source' as baseMarkId, [], {
    ...debuff.config,
    maxStacks: 20,
    persistent: true,
    duration: -1,
  }).createInstance()
  mark.stack = options.sourceStack ?? 3
  mark.setOwner(owner, battle.emitter)
  owner.marks.push(mark)
  const source = kind === 'mark' ? mark : skill
  source.effects.push(native ? generatedMultihit[id] : oracles.get(id)!)
  if (native) effectAuthoring.effectParameters(generatedMultihit[id]).install(battle.configSystem)
  if (options.percent !== undefined) {
    const key = native
      ? parameterAddress(id, 'parameters', 'condition_1_percent')
      : battle.configSystem.getRegisteredKeys().find(key => key.startsWith(`${id}.`))!
    battle.configSystem.set(key, options.percent, source)
  }
  if (options.tagPercent !== undefined) {
    const key = native
      ? parameterAddress(id, 'parameters', 'condition_1_percent')
      : battle.configSystem.getRegisteredKeys().find(key => key.startsWith(`${id}.`))!
    expect(battle.configSystem.getConfigKeysByTag('skill_effect_probability')).toContain(key)
    battle.configSystem.addTaggedConfigModifier(
      'skill_effect_probability',
      ConfigModifierType.override,
      options.tagPercent,
      0,
      ConfigDurationType.binding,
      source,
      source,
    )
  }
  const supports: ReturnType<typeof mark.base.createInstance>[] = []
  const supportNames = [
    ...new Set((JSON.stringify(d).match(/mark_[a-z_]+/g) ?? []).filter((s: string) => !s.startsWith('mark_shuang'))),
  ]
  if (variant !== 'empty')
    for (const pet of [a.activePet, b.activePet])
      for (const name of supportNames)
        for (const count of options.counts ?? [3]) {
          const m = new BaseMark(name as baseMarkId, [], {
            ...debuff.config,
            maxStacks: 100,
            persistent: true,
            duration: -1,
          }).createInstance()
          m.stack = count
          m.duration = count
          m.setOwner(pet, battle.emitter)
          pet.marks.push(m)
          supports.push(m)
        }
  const turn = new TurnContext(battle),
    use = new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, skill)
  use.updateActualTarget()
  use.multihit = options.initial ?? 2
  use.multihitResult = options.initial ?? 2
  use.rage = 0
  a.activePet.lastSkill = skill
  a.activePet.lastSkillUsedTimes = options.uses ?? 3
  if (variant === 'phase' || variant === 'miss') a.activePet.lastSkillUsedTimes--
  const rival = new UseSkillContext(turn, b, b.activePet, AttackTargetOpinion.opponent, b.activePet.skills[0])
  if (variant !== 'empty-order') {
    const order = variant === 'wrong-order' ? [rival, use] : [use, rival]
    turn.appledContexts.push(...order)
    turn.contexts.push(...order)
  }
  if (variant === 'wrong-role') {
    if (defensive) use.actualTarget = a.activePet
    else source.setOwner(b.activePet, battle.emitter)
  }
  let admitted = 0,
    draws = 0
  const random = battle.random.bind(battle)
  battle.random = () => {
    draws++
    return options.roll ?? random()
  }
  const events: string[] = [],
    snapshots: number[] = []
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/multihit-observer' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.BeforeMultiHit, EffectTrigger.OnHit, EffectTrigger.OnMiss],
      priority: 100,
      when: c =>
        c.trigger !== EffectTrigger.BeforeEffect || (c.parent instanceof EffectContext && c.parent.effect?.id === id),
      apply(c) {
        if (c.trigger === EffectTrigger.BeforeEffect) {
          if (!(c.parent instanceof EffectContext) || c.parent.effect?.id !== id) return
          admitted++
          if (variant === 'cancel') c.parent.available = false
          if (variant === 'late-value') {
            for (const m of supports) {
              m.stack = 7
              m.duration = 7
            }
            a.activePet.lastSkillUsedTimes = 5
          }
          if (variant === 'late-target') use.actualTarget = b.team[1]
          if (variant === 'late-owner') source.setOwner(a.team[1], battle.emitter)
        } else if (c.trigger === EffectTrigger.BeforeMultiHit) snapshots.push(use.multihitResult)
        else events.push(c.trigger)
      },
    }),
  )
  const trigger = d.trigger as EffectTrigger
  if (variant === 'turn-first' || variant === 'turn-second') {
    const other = new SkillInstance(skill.base)
    other.setOwner(b.activePet)
    b.activePet.skills[0] = other
    battle.skillMap.set(other.id, other)
    a.activePet.attributeSystem.updateBaseValue('spe', variant === 'turn-first' ? 200 : 50)
    b.activePet.attributeSystem.updateBaseValue('spe', 100)
    a.selection = { player: a.id, type: 'use-skill', skill: skill.id, target: skill.target }
    b.selection = { player: b.id, type: 'use-skill', skill: other.id, target: other.target }
    turn.appledContexts.splice(0)
    turn.contexts.splice(0)
    executeTurnOperation(turn, battle)
    const executed = turn.appledContexts.filter((c): c is UseSkillContext => c instanceof UseSkillContext)
    expect(executed.map(c => c.pet)).toEqual(
      variant === 'turn-first' ? [a.activePet, b.activePet] : [b.activePet, a.activePet],
    )
    const own = executed.find(c => c.pet === a.activePet)!
    return {
      admitted,
      cursor: own.currentHitCount,
      initial: own.multihit,
      resolvedHits: own.multihitResult,
      next: random(),
    }
  } else if (variant === 'phase' || variant === 'miss') {
    use.hitOverrides.push({ willHit: variant !== 'miss', priority: 1000 })
    const p = new SkillPhase(battle, a, a.activePet, AttackTargetOpinion.opponent, skill, turn, use)
    p.initialize()
    p.execute()
  } else {
    const parent = variant === 'nested' ? new EffectContext(use, EffectTrigger.BeforeEffect, source) : use
    battle.applyEffects(parent, trigger, source)
    if (variant === 'repeat') battle.applyEffects(parent, trigger, source)
  }
  return {
    admitted,
    initial: use.multihit,
    resolvedHits: use.multihitResult,
    cursor: use.currentHitCount,
    stack: mark.stack,
    events,
    snapshots,
    draws,
    next: random(),
  }
}
for (const id of ids)
  for (const kind of id.startsWith('effect_mark_shuang') ? (['mark'] as const) : (['skill', 'mark'] as const))
    for (const variant of variants)
      it(`${id}/${kind}/${variant}`, () => expect(run(id, true, kind, variant)).toEqual(run(id, false, kind, variant)))
for (const native of [false, true]) {
  for (const counts of [[], [2, 7], [7, 2]]) {
    it(`add reads all selected stacks ${native}/${counts}`, () => {
      const r = run('effect_skill_add_hit_result_ruodian', native, 'skill', 'normal', { counts })
      expect(r.resolvedHits).toBe(2 + counts.reduce((a, b) => a + b, 0))
    })
    it(`set reads first duration ${native}/${counts}`, () => {
      const r = run('effect_skill_multihit_by_shahezhili_turns', native, 'skill', 'normal', { counts })
      expect(r.initial).toBe(counts[0] ?? 2)
    })
  }
  it(`early additions are overwritten when initial hits resolve ${native}`, () => {
    const r = run('effect_skill_add_hit_result_ruodian', native, 'skill', 'phase', { counts: [2, 7] })
    expect(r.cursor).toBe(3)
    expect(r.resolvedHits).toBe(2)
    expect(r.events).toEqual(['OnHit', 'OnHit'])
  })
  for (const uses of [1, 2, 3, 4, 5]) {
    it(`usage counts at execution ${native}/${uses}`, () => {
      const r = run('effect_skill_add_multihit_per_usetime', native, 'skill', 'phase', { uses })
      expect(r.cursor).toBe(3 + Math.min(uses - 1, 3))
      const reduced = run('effect_skill_reduce_multihit_on_consecutive_hits_1_max_2', native, 'skill', 'phase', {
        uses,
      })
      expect(reduced.cursor).toBe(3 - Math.min(uses - 1, 2))
    })
  }
  it(`late stage adds one hit and misses stop at first attempt ${native}`, () => {
    const r = run('effect_ability_add_multihit_1_on_multihit_skill', native, 'mark', 'phase')
    expect(r.cursor).toBe(4)
    expect(r.events).toHaveLength(3)
    const miss = run('effect_ability_add_multihit_1_on_multihit_skill', native, 'mark', 'miss')
    expect(miss.cursor).toBe(1)
    expect(miss.resolvedHits).toBe(3)
    expect(miss.events).toEqual(['OnMiss'])
  })
}
for (const id of ids.filter(id => id.includes('_percent_')))
  for (const percent of [0, 30, 100])
    for (const roll of [0, 0.29999, 0.3, 0.30001, 0.99999])
      it(`configured probability ${id}/${percent}/${roll}`, () => {
        const actual = run(id, true, 'skill', 'normal', { percent, roll })
        expect(actual).toEqual(run(id, false, 'skill', 'normal', { percent, roll }))
        expect(actual.draws).toBe(1)
        expect(actual.admitted).toBe(Number(roll < percent / 100))
      })
it('pins original sources, correction decisions and complete catalog coverage', () => {
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
  expect(ids).toHaveLength(18)
  expect(ledger.rejected).toEqual([])
  expect(ledger.records.map((r: { id: string }) => r.id).sort()).toEqual([...ids].sort())
  for (const id of ids) {
    const d = originals.get(id),
      r = ledger.records.find((r: { id: string }) => r.id === id)
    expect(r.definitionSha256).toBe(
      createHash('sha256')
        .update(JSON.stringify(normalize(d)))
        .digest('hex'),
    )
    if (id.startsWith('effect_mark_shuang')) expect(() => EffectParser.parse(d)).toThrow()
    else expect(() => EffectParser.parse(d)).not.toThrow()
    expect(r.decision).toBe('C07')
    expect(r.classification).toBe('U')
    if (id.startsWith('effect_mark_shuang')) expect(r.additionalDecisions).toEqual(['C09'])
    if (id.endsWith('_first') || id.endsWith('_last')) expect(r.additionalDecisions).toEqual(['C08'])
  }
})
for (const operation of ['addMultihitResult', 'setMultihit'] as const)
  for (const values of [[], [2, 7], [7, 2], [-3], [0.5]])
    it(`operator per-context reads ${operation}/${values}`, () => {
      const { battle, a } = makeScenario(1602)
      battles.push(battle)
      const turn = new TurnContext(battle),
        uses = [0, 1].map(
          () => new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, a.activePet.skills[0]),
        )
      const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
      let reads = 0
      const input = selectFrom(values)
        .all()
        .map(items => {
          reads++
          return items.map(v => v + reads - 1)
        })
      const effect = compileEffect(
        defineEffect({
          id: 'fixture/multihit-read',
          on: 'BeforeMultiHit',
          execute: selectFrom(uses).apply(ops[operation](input)),
        }),
      )
      const c = new EffectContext(uses[0], EffectTrigger.BeforeMultiHit, a.activePet.skills[0], effect)
      battle.executionBudget.run(battle.currentTurn, () => effect.innerApply(c))
      expect(reads).toBe(2)
      uses.forEach((use, index) => {
        const oracle = new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, a.activePet.skills[0])
        Operators[operation](values.map(v => v + index))(c, [oracle])
        expect([use.multihit, use.multihitResult]).toEqual([oracle.multihit, oracle.multihitResult])
      })
    })

for (const native of [false, true]) {
  for (const initial of [0, 1, 2])
    it(`ability requires resolved count above one ${native}/${initial}`, () => {
      const r = run('effect_ability_add_multihit_1_on_multihit_skill', native, 'mark', 'normal', { initial })
      expect(r.admitted).toBe(Number(initial > 1))
      expect(r.resolvedHits).toBe(initial + Number(initial > 1))
    })
  for (const id of ['effect_mark_shuangrenzhan_add_2_hits', 'effect_mark_shuangpozhan_add_2_hits'] as const)
    it(`last source stack still appends both hits ${native}/${id}`, () => {
      const r = run(id, native, 'mark', 'normal', { sourceStack: 1 })
      expect(r.admitted).toBe(1)
      expect(r.resolvedHits).toBe(4)
      expect(r.stack).toBe(0)
    })
}
for (const id of ids.filter(id => id.endsWith('_first') || id.endsWith('_last')))
  for (const kind of ['skill', 'mark'] as const)
    for (const variant of ['turn-first', 'turn-second'] as const)
      it(`real turn order ${id}/${kind}/${variant}`, () => {
        const actual = run(id, true, kind, variant)
        expect(actual).toEqual(run(id, false, kind, variant))
        const allowed = id.endsWith('_first') ? variant === 'turn-first' : variant === 'turn-second'
        expect(actual.admitted).toBe(Number(allowed))
        expect(actual.cursor).toBe(allowed ? 5 : 2)
      })

for (const operation of ['addMultihitResult', 'setMultihit'] as const)
  for (const variant of ['foreign', 'foreign-after-read', 'nonfinite', 'absent'] as const)
    it(`operator boundaries ${operation}/${variant}`, () => {
      const { battle, a } = makeScenario(1603),
        other = makeScenario(1604)
      battles.push(battle, other.battle)
      const use = new UseSkillContext(
        new TurnContext(battle),
        a,
        a.activePet,
        AttackTargetOpinion.opponent,
        a.activePet.skills[0],
      )
      const foreign = new UseSkillContext(
        new TurnContext(other.battle),
        other.a,
        other.a.activePet,
        AttackTargetOpinion.opponent,
        other.a.activePet.skills[0],
      )
      const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
      let reads = 0
      const input = selectFrom(variant === 'absent' ? [] : [2])
        .select(n => {
          reads++
          if (variant === 'foreign-after-read') Object.defineProperty(use, 'battle', { value: other.battle })
          return variant === 'nonfinite' ? Infinity : n
        })
        .first()
      const effect = compileEffect(
        defineEffect({
          id: 'fixture/multihit-boundary',
          on: 'BeforeMultiHit',
          execute: selectFrom([variant === 'foreign' ? foreign : use]).apply(ops[operation](input)),
        }),
      )
      const c = new EffectContext(use, EffectTrigger.BeforeMultiHit, a.activePet.skills[0], effect)
      const apply = () => battle.executionBudget.run(battle.currentTurn, () => effect.innerApply(c))
      if (variant === 'absent') apply()
      else
        expect(apply).toThrow(variant === 'nonfinite' ? 'Expected finite numeric input' : 'Cross-battle skill context')
      expect(reads).toBe(variant === 'foreign' || variant === 'absent' ? 0 : 1)
      expect([use.multihit, use.multihitResult]).toEqual([1, 1])
    })

for (const id of ids.filter(id => id.includes('_percent_')))
  for (const tagPercent of [0, 100])
    it(`tagged probability override ${id}/${tagPercent}`, () => {
      const actual = run(id, true, 'mark', 'normal', { tagPercent, roll: 0.6 })
      expect(actual).toEqual(run(id, false, 'mark', 'normal', { tagPercent, roll: 0.6 }))
      expect(actual.admitted).toBe(Number(tagPercent === 100))
    })
