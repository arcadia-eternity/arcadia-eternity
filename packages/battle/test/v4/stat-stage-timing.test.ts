import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedStatStageCandidates,
  BaseMark,
  BaseSkill,
  SkillInstance,
  SkillPhase,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  Category,
  Element,
  StatLevelMarkInstanceImpl,
  StatTypeWithoutHp,
  GameRng,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type baseSkillId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const specs = [
  {
    id: 'effect_emblem_raise_spd_1_stage_when_baonuan_20_percent',
    on: EffectTrigger.OnHit,
    stat: StatTypeWithoutHp.spd,
    amount: 1,
    skill: 'skill_baonuan',
    decisions: ['C07', 'C09'],
  },
  {
    id: 'effect_emblem_raise_spd_1_stage_when_rouruan_20_percent',
    on: EffectTrigger.OnHit,
    stat: StatTypeWithoutHp.spd,
    amount: 1,
    skill: 'skill_rouruan',
    decisions: ['C07', 'C09'],
  },
  {
    id: 'effect_mark_reduce_opponent_atk_1_stage_when_fainted',
    on: EffectTrigger.OnDefeat,
    stat: StatTypeWithoutHp.atk,
    amount: -1,
    defensive: true,
  },
  {
    id: 'effect_mark_reduce_opponent_spe_1_stage_when_fainted',
    on: EffectTrigger.OnDefeat,
    stat: StatTypeWithoutHp.spe,
    amount: -1,
    defensive: true,
  },
  {
    id: 'effect_skill_raise_atk_1_stage_on_crit',
    on: EffectTrigger.OnCritPreDamage,
    stat: StatTypeWithoutHp.atk,
    amount: 1,
  },
  {
    id: 'effect_skill_raise_self_spa_1_stage_if_3_hits',
    on: EffectTrigger.BeforeMultiHit,
    stat: StatTypeWithoutHp.spa,
    amount: 1,
    hits: 3,
    decisions: ['C07'],
  },
  {
    id: 'effect_skill_raise_spe_1_stage_if_opponent_has_tongjiling_on_defeated',
    on: EffectTrigger.OnDefeat,
    stat: StatTypeWithoutHp.spe,
    amount: 1,
    mark: 'mark_tongjiling',
  },
  {
    id: 'effect_skill_reduce_opponent_spa_1_stage_if_opponent_has_kaowen_and_last',
    on: EffectTrigger.BeforeHit,
    stat: StatTypeWithoutHp.spa,
    amount: -1,
    mark: 'mark_kaowen',
    last: true,
    decisions: ['C08'],
  },
] as const
interface Spec {
  id: string
  on: EffectTrigger
  stat: StatTypeWithoutHp
  amount: number
  skill?: string
  defensive?: boolean
  hits?: number
  mark?: string
  last?: boolean
  decisions?: readonly string[]
}
const definitions = new Map(
  ['ability', 'emblem', 'mark', 'skill']
    .flatMap(name =>
      parse(readFileSync(new URL(`../../../../packs/base/data/effect_${name}.yaml`, import.meta.url), 'utf8'), {
        merge: true,
      }),
    )
    .map(d => [d.id, d]),
)
const oracles = new Map(
  specs.map((spec: Spec) => {
    const copy = structuredClone(definitions.get(spec.id))
    if (spec.skill || spec.hits) {
      expect(copy.condition.conditions[1].target.base).toBe('useSkillContext')
      copy.condition.conditions[1].target.base = 'usingSkillContext'
      if (spec.skill) {
        expect(() => EffectParser.parse(copy)).toThrow(/skillId/)
        expect(copy.condition.conditions[1].target.chain[0].arg).toBe('skillId')
        copy.condition.conditions[1].target.chain[0].arg = 'skill'
      }
    }
    return [spec.id, EffectParser.parse(copy)]
  }),
)
const ledger = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/stat-stages-candidates.json', import.meta.url), 'utf8'),
)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
const variants = [
  'normal',
  'false',
  'wrong-owner',
  'other-skill',
  'nested',
  'missing-skill',
  'late-condition',
  'late-owner',
  'late-active',
  'cancel',
  'phase',
] as const
function run(spec: Spec, native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number], seed = 6) {
  const { battle, a, b, debuff } = makeScenario(seed)
  battles.push(battle)
  const pets = [...a.team, ...b.team]
  for (const p of pets) for (const s of p.skills) s.effects.splice(0)
  const actor = a.activePet,
    victim = b.activePet,
    owner = spec.defensive ? victim : actor
  if (spec.skill) {
    const skill = new SkillInstance(
      new BaseSkill(
        spec.skill as baseSkillId,
        Category.Status,
        Element.Normal,
        0,
        100,
        0,
        0,
        AttackTargetOpinion.opponent,
      ),
      { effects: [] },
    )
    skill.owner = actor
    actor.skills[0] = skill
  }
  const source =
    kind === 'skill'
      ? owner.skills[0]
      : new BaseMark('fixture/timing-source' as baseMarkId, [], debuff.config).createInstance()
  if (kind === 'mark') {
    source.owner = owner
    owner.marks.push(source as (typeof owner.marks)[number])
  }
  const effects = generatedStatStageCandidates.effects as Record<string, (typeof actor.skills)[0]['effects'][number]>
  source.effects.push(native ? effects[spec.id] : oracles.get(spec.id)!)
  const selected =
    variant === 'other-skill' ? new SkillInstance(actor.skills[0].base, { effects: [] }) : actor.skills[0]
  selected.owner = actor
  const turn = new TurnContext(battle),
    use = new UseSkillContext(turn, a, actor, AttackTargetOpinion.opponent, selected)
  use.updateActualTarget()
  use.multihitResult = spec.hits ?? 1
  if (spec.mark) {
    const m = new BaseMark(spec.mark as baseMarkId, [], debuff.config).createInstance()
    m.owner = victim
    victim.marks.push(m)
  }
  const other = new UseSkillContext(turn, b, victim, AttackTargetOpinion.opponent, victim.skills[0])
  turn.contexts.push(use, other)
  function mismatch() {
    if (spec.skill)
      use.skill = new SkillInstance(
        new BaseSkill(
          'fixture/other' as baseSkillId,
          Category.Status,
          Element.Normal,
          0,
          100,
          0,
          0,
          AttackTargetOpinion.opponent,
        ),
        { effects: [] },
      )
    else if (spec.hits) use.multihitResult = 2
    else if (spec.last) turn.contexts.splice(0, turn.contexts.length, other, use)
    else if (spec.mark) victim.marks = victim.marks.filter(m => m.baseId !== spec.mark)
    else if (spec.defensive) use.actualTarget = actor
    else source.owner = a.team[1]
  }
  if (variant === 'false') mismatch()
  if (variant === 'wrong-owner') source.owner = owner.owner!.team[1]
  const events: { remaining: number; ordinal: number; alive: boolean }[] = []
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/timing-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === spec.id,
      apply(ctx) {
        events.push({ remaining: use.multihitResult, ordinal: use.currentHitCount, alive: victim.isAlive })
        if (variant === 'late-condition') mismatch()
        if (variant === 'late-owner') source.owner = owner.owner!.team[1]
        if (variant === 'late-active') {
          const opponent = battle.getOpponent(owner.owner!)
          opponent.activePet = opponent.team[1]
        }
        if (variant === 'cancel' && ctx.parent instanceof EffectContext) ctx.parent.available = false
      },
    }),
  )
  if (variant === 'phase') {
    use.category =
      spec.on === EffectTrigger.OnDefeat || spec.on === EffectTrigger.OnCritPreDamage
        ? Category.Physical
        : Category.Status
    use.power = spec.on === EffectTrigger.OnDefeat ? 1000 : 1
    use.multihit = spec.hits ?? 1
    use.hitOverrides.push({ willHit: true, priority: 0 })
    use.critOverrides.push({ willCrit: spec.on === EffectTrigger.OnCritPreDamage, priority: 0 })
    if (spec.on === EffectTrigger.OnDefeat) victim.currentHp = 1
    a.currentRage = a.maxRage
    const phase = new SkillPhase(battle, a, actor, AttackTargetOpinion.opponent, selected, turn, use)
    phase.initialize()
    phase.execute()
  } else {
    const parent =
      variant === 'missing-skill'
        ? turn
        : variant === 'nested'
          ? new EffectContext(use, EffectTrigger.BeforeEffect, source)
          : use
    battle.applyEffects(parent, spec.on, source)
  }
  return {
    events,
    levels: pets.map(p =>
      p.marks
        .filter((m): m is StatLevelMarkInstanceImpl => m instanceof StatLevelMarkInstanceImpl)
        .map(m => ({ stat: m.statType, level: m.level })),
    ),
    nextRandom: battle.random(),
  }
}
for (const spec of specs as readonly Spec[]) {
  it(`${spec.id} pins explicit decisions and source repairs`, () => {
    const r = ledger.records.find((r: { id: string }) => r.id === spec.id)
    expect(r.recipe.additionalDecisions ?? []).toEqual(spec.decisions ?? [])
    if (spec.skill || spec.hits) {
      expect(() => EffectParser.parse(definitions.get(spec.id))).toThrow(/useSkillContext/)
      expect(r.recipe.selectorRepairs).toEqual(['/condition/conditions/1/target/base'])
    } else expect(() => EffectParser.parse(definitions.get(spec.id))).not.toThrow()
    if (spec.skill)
      expect(r.recipe.pathRepairs).toEqual([
        { path: '/condition/conditions/1/target/chain/0/arg', before: 'skillId', after: 'skill' },
      ])
  })
  for (const kind of ['skill', 'mark'] as const)
    it.each(variants)(`${spec.id} ${kind}: %s`, variant => {
      const actual = run(spec, true, kind, variant)
      expect(actual).toEqual(run(spec, false, kind, variant))
      const admitted =
        !['false', 'wrong-owner', 'cancel', 'missing-skill'].includes(variant) &&
        !(variant === 'nested' && (spec.defensive || spec.last)) &&
        !(variant === 'other-skill' && !spec.defensive && kind === 'skill')
      if (admitted) {
        expect(actual.levels.flat()).toEqual([{ stat: spec.stat, level: spec.amount }])
        expect(actual.events).toHaveLength(1)
      } else expect(actual.levels.flat()).toEqual([])
      if (variant === 'phase' && spec.hits) expect(actual.events).toEqual([{ remaining: 3, ordinal: 0, alive: true }])
      if (variant === 'phase' && spec.on === EffectTrigger.OnDefeat) expect(actual.events[0].alive).toBe(false)
      if (variant === 'late-owner' && !spec.defensive && spec.amount > 0)
        expect(actual.levels[1]).toEqual([{ stat: spec.stat, level: spec.amount }])
      if (variant === 'late-active' && spec.amount < 0)
        expect(actual.levels[spec.defensive ? 1 : 3]).toEqual([{ stat: spec.stat, level: spec.amount }])
      if (variant !== 'phase') {
        const rng = new GameRng(6)
        if (
          spec.skill &&
          !['false', 'wrong-owner', 'missing-skill'].includes(variant) &&
          !(variant === 'other-skill' && kind === 'skill')
        )
          rng.next()
        expect(actual.nextRandom).toBe(rng.next())
      }
    })
  if (spec.skill)
    for (const kind of ['skill', 'mark'] as const)
      it(`${spec.id} ${kind} can fail its probability roll`, () => {
        const actual = run(spec, true, kind, 'normal', 1)
        expect(actual).toEqual(run(spec, false, kind, 'normal', 1))
        expect(actual.levels.flat()).toEqual([])
      })
}
