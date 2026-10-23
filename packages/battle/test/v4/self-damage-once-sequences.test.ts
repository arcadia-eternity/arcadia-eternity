import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  DamageContext,
  DamagePhase,
  DamageType,
  AttackTargetOpinion,
  Category,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { generatedVitalSequences, generatedVitalActions } from '@arcadia-eternity/data-pack-base/native'

const ids = [
  'effect_mark_self_damage_50_percent_once',
  'effect_mark_self_damage_50_percent_once_when_special',
  'effect_mark_self_damage_25_percent',
] as const
const candidates = { ...generatedVitalSequences, ...generatedVitalActions }
const definitions = parse(
  readFileSync(new URL('./fixtures/effect-regression/effect_mark.yaml', import.meta.url), 'utf8'),
  { merge: true },
)
const originals = ids.map(id => definitions.find((d: { id: string }) => d.id === id))
function corrected(index: number) {
  const d = structuredClone(originals[index])
  d.condition.conditions[1].target.base = 'usingSkillContext'
  d.condition.conditions[2].target.chain[0].arg = 'source'
  return d
}
const oracles = ids.map((_, i) => EffectParser.parse(corrected(i)))
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
  'physical',
  'status',
  'same-source',
  'same-base-other-source',
  'opponent-use',
  'late-value',
  'late-owner',
  'late-category',
  'cancel',
  'nested',
  'repeat',
  'phase',
  'damage-owner',
  'damage-detach',
  'zero',
  'odd',
  'low-hp',
] as const
function run(native: boolean, index: number, variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(1101)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) {
    for (const s of p.skills) s.effects.splice(0)
    p.attributeSystem.updateBaseValue('maxHp', 2001)
    p.currentHp = 1000
  }
  const base = new BaseMark('fixture/self-damage' as baseMarkId, [], { ...debuff.config, duration: -1, maxStacks: 10 })
  const mark = base.createInstance()
  mark.setOwner(a.activePet, battle.emitter)
  mark.stack = 3
  a.activePet.marks.push(mark)
  mark.effects.push(native ? candidates[ids[index]] : oracles[index])
  const actor = variant === 'opponent-use' ? b : a
  const use = new UseSkillContext(
    new TurnContext(battle),
    actor,
    actor.activePet,
    AttackTargetOpinion.opponent,
    actor.activePet.skills[0],
  )
  use.updateActualTarget()
  use.category = variant === 'physical' ? Category.Physical : variant === 'status' ? Category.Status : Category.Special
  const other = base.createInstance()
  other.setOwner(a.activePet, battle.emitter)
  a.activePet.marks.push(other)
  let damage = new DamageContext(
    use,
    variant === 'same-source' ? mark : variant === 'same-base-other-source' ? other : actor.activePet,
    b.activePet,
    101,
    DamageType.Special,
  )
  damage.damageResult = variant === 'zero' ? 0 : variant === 'odd' ? 3 : 101
  if (variant === 'low-hp') a.activePet.currentHp = 7
  let admitted = 0
  const trace: { amount: number; target: number; active: boolean; stack: number }[] = []
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/self-damage-before' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === ids[index],
      apply(c) {
        const outer = c.parent as EffectContext<EffectTrigger>
        admitted++
        if (outer.parent instanceof DamageContext) damage = outer.parent
        if (variant === 'cancel') outer.available = false
        if (variant === 'late-value') damage.damageResult = 47
        if (variant === 'late-owner') mark.owner = a.team[1]
        if (variant === 'late-category') use.category = Category.Status
      },
    }),
  )
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/self-damage-hit' as effectId,
      triggers: [EffectTrigger.OnDamage],
      when: c =>
        c.parent instanceof DamageContext &&
        c.parent.parent instanceof EffectContext &&
        c.parent.parent.effect?.id === ids[index],
      apply(c) {
        const event = c.parent as DamageContext
        trace.push({
          amount: event.damageResult,
          target: a.team.indexOf(event.target),
          active: mark.isActive,
          stack: mark.stack,
        })
        if (variant === 'damage-owner') mark.owner = a.team[1]
        if (variant === 'damage-detach') mark.owner = null
      },
    }),
  )
  if (variant === 'phase') {
    const phase = new DamagePhase(battle, use, a.activePet, b.activePet, 101, DamageType.Special)
    phase.initialize()
    phase.execute()
  } else {
    const event = variant === 'nested' ? new EffectContext(damage, EffectTrigger.BeforeEffect, mark) : damage
    battle.applyEffects<EffectTrigger>(event, EffectTrigger.OnDamage, mark)
    if (variant === 'repeat') battle.applyEffects<EffectTrigger>(event, EffectTrigger.OnDamage, mark)
  }
  return {
    admitted,
    trace,
    hp: a.team.map(p => p.currentHp),
    victim: b.activePet.currentHp,
    active: mark.isActive,
    stack: mark.stack,
    owner: mark.owner ? a.team.indexOf(mark.owner as typeof a.activePet) : -1,
    next: battle.random(),
  }
}
for (const [index, id] of ids.entries()) {
  it(`${id} pins the explicit source correction`, () => {
    expect(() => EffectParser.parse(originals[index])).toThrow()
    const spelling = structuredClone(originals[index])
    spelling.condition.conditions[1].target.base = 'usingSkillContext'
    expect(() => EffectParser.parse(spelling)).toThrow(/sourceId/)
    const ledger = JSON.parse(
      readFileSync(
        new URL(
          `../../../../docs/v4/validation/${index === 2 ? 'vital-actions' : 'vital-sequences'}-candidates.json`,
          import.meta.url,
        ),
        'utf8',
      ),
    )
    const r = ledger.records.find((r: { id: string }) => r.id === id)
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
    expect(r.definitionSha256).toBe(
      createHash('sha256')
        .update(JSON.stringify(normalize(originals[index])))
        .digest('hex'),
    )
    expect(r.recipe.repairedPaths).toEqual(['/condition/conditions/1/target/base'])
    expect(r.recipe.pathRepairs).toEqual([
      { path: '/condition/conditions/2/target/chain/0/arg', before: 'sourceId', after: 'source' },
    ])
    expect(r.recipe.actions.map((a: { sourcePath: string }) => a.sourcePath)).toEqual(
      index === 2 ? ['/apply'] : ['/apply/0', '/apply/1'],
    )
  })
  for (const variant of variants)
    it(`${id} ${variant}`, () => {
      const actual = run(true, index, variant)
      expect(actual).toEqual(run(false, index, variant))
      const rejected =
        variant === 'same-source' ||
        variant === 'opponent-use' ||
        variant === 'status' ||
        (index === 1 && variant === 'physical')
      if (rejected) {
        expect(actual.admitted).toBe(0)
        expect(actual.trace).toEqual([])
        expect(actual.active).toBe(true)
        return
      }
      expect(actual.admitted).toBe(index === 2 && variant === 'repeat' ? 2 : 1)
      if (variant === 'cancel') {
        expect(actual.trace).toEqual([])
        expect(actual.active).toBe(true)
        return
      }
      const amount = Math.floor(
        (variant === 'late-value' ? 47 : variant === 'zero' ? 0 : variant === 'odd' ? 3 : 101) *
          (index === 2 ? 0.25 : 0.5),
      )
      expect(actual.trace).toEqual(
        Array.from({ length: index === 2 && variant === 'repeat' ? 2 : 1 }, () => ({
          amount,
          target: variant === 'late-owner' ? 1 : 0,
          active: true,
          stack: 3,
        })),
      )
      expect(actual.active).toBe(index === 2)
      if (variant === 'normal' || variant === 'phase' || variant === 'repeat')
        expect(actual.hp[0]).toBe(index === 2 && variant !== 'repeat' ? 975 : 950)
      if (variant === 'phase') expect(actual.victim).toBe(899)
      if (variant === 'low-hp') expect(actual.hp[0]).toBe(0)
    })
}
