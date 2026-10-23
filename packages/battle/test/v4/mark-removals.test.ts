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
  SkillPhase,
  RemoveMarkContext,
  AttackTargetOpinion,
  defineNativeEffect,
  setGlobalLogger,
  executeTurnOperation,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { generatedMarkRemovals } from '@arcadia-eternity/data-pack-base/native'

const definitions = ['global', 'ability', 'emblem', 'mark', 'skill'].flatMap(name =>
  parse(readFileSync(new URL(`../../../../packs/base/data/effect_${name}.yaml`, import.meta.url), 'utf8'), {
    merge: true,
  }),
)
type Id = keyof typeof generatedMarkRemovals
const ids = Object.keys(generatedMarkRemovals) as Id[]
const originals = new Map(ids.map(id => [id, definitions.find(d => d.id === id)]))
const oracles = new Map(ids.map(id => [id, EffectParser.parse(originals.get(id))]))
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
  'cancel',
  'wrong-owner',
  'late-add',
  'late-remove',
  'late-owner',
  'indestructible',
  'remove-next',
  'add-during',
  'nested',
  'repeat',
  'phase',
  'below-threshold',
  'at-threshold',
  'noncrit-phase',
  'late-value',
] as const
function run(native: boolean, id: Id, trigger: EffectTrigger, variant: (typeof variants)[number], skillSource = false) {
  const { battle, a, b, debuff } = makeScenario(1201)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) {
    for (const s of p.skills) s.effects.splice(0)
    p.attributeSystem.updateBaseValue('maxHp', 2001)
    p.currentHp = 1500
  }
  const d = originals.get(id)!,
    sourceTarget = typeof d.apply.target === 'string' || d.apply.target.base === 'mark'
  const removed: string[] = []
  const add = (baseId: string, label: string, destroyable = true, owner = a.activePet, tags: string[] = []) => {
    const m = new BaseMark(
      baseId as baseMarkId,
      [],
      { ...debuff.config, duration: -1, persistent: true, destroyable },
      tags,
    ).createInstance()
    m.setOwner(owner, battle.emitter)
    owner.marks.push(m)
    m.effects.push(
      defineNativeEffect({
        id: `fixture/remove/${label}` as effectId,
        triggers: [EffectTrigger.OnMarkDestroy],
        apply() {
          removed.push(label)
        },
      }),
    )
    return m
  }
  const sourceMark = add('fixture/source', 'source', variant !== 'indestructible')
  const source = skillSource ? a.activePet.skills[0] : sourceMark
  source.effects.push(native ? generatedMarkRemovals[id] : oracles.get(id)!)
  const wanted = d.apply.target.chain?.[0]?.evaluator.value ?? 'mark_status_fixture'
  const first = add(wanted, 'first', variant !== 'indestructible', a.activePet, ['status'])
  const second = add(wanted, 'second', true, a.activePet, ['status'])
  add('fixture/unrelated', 'unrelated')
  if (id === 'effect_skill_clear_status_if_has_niliu') add('mark_niliu', 'support')
  const defensive =
    trigger === EffectTrigger.PostDamage ||
    trigger === EffectTrigger.OnCritPostDamage ||
    id === 'effect_mark_yingfeng_destroy_on_hit_or_miss'
  const attacker = defensive ? b : a,
    victim = defensive ? a : b
  const actor = variant === 'wrong-owner' ? victim : attacker
  const turn = new TurnContext(battle)
  const use = new UseSkillContext(turn, actor, actor.activePet, AttackTargetOpinion.opponent, actor.activePet.skills[0])
  use.updateActualTarget()
  const damage = new DamageContext(
    use,
    actor.activePet,
    variant === 'wrong-owner' ? b.activePet : victim.activePet,
    101,
    DamageType.Effect,
    trigger === EffectTrigger.OnCritPostDamage && variant !== 'noncrit-phase',
  )
  damage.damageResult = variant === 'below-threshold' ? 99 : variant === 'at-threshold' ? 100 : 101
  let admitted = 0
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/removal-before' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        const outer = c.parent as EffectContext<EffectTrigger>
        admitted++
        if (variant === 'cancel') outer.available = false
        if (variant === 'late-add') add(wanted, 'late', true, a.activePet, ['status'])
        if (variant === 'late-remove') battle.removeMark(new RemoveMarkContext(c, first))
        if (variant === 'late-owner') {
          source.owner = a.team[1]
          add(wanted, 'reserve', true, a.team[1], ['status'])
        }
        if (variant === 'late-value' && outer.parent instanceof DamageContext) outer.parent.damageResult = 1
      },
    }),
  )
  first.effects.push(
    defineNativeEffect({
      id: 'fixture/removal-callback' as effectId,
      triggers: [EffectTrigger.OnMarkDestroy],
      apply(c) {
        if (variant === 'remove-next') battle.removeMark(new RemoveMarkContext(c, second))
        if (variant === 'add-during') add(wanted, 'during', true, a.activePet, ['status'])
      },
    }),
  )
  if (variant === 'phase' || variant === 'noncrit-phase') {
    if (trigger === EffectTrigger.TurnEnd) {
      a.selection = { player: a.id, type: 'do-nothing' }
      b.selection = { player: b.id, type: 'do-nothing' }
      executeTurnOperation(turn, battle)
    } else if ([EffectTrigger.PostDamage, EffectTrigger.OnCritPostDamage].includes(trigger)) {
      const p = new DamagePhase(
        battle,
        use,
        actor.activePet,
        victim.activePet,
        101,
        DamageType.Physical,
        trigger === EffectTrigger.OnCritPostDamage && variant !== 'noncrit-phase',
      )
      p.initialize()
      p.execute()
    } else {
      use.hitOverrides.push({ willHit: trigger !== EffectTrigger.OnMiss, priority: 1000 })
      const p = new SkillPhase(
        battle,
        actor,
        actor.activePet,
        AttackTargetOpinion.opponent,
        actor.activePet.skills[0],
        turn,
        use,
      )
      p.initialize()
      p.execute()
    }
  } else {
    const parent =
      trigger === EffectTrigger.TurnEnd
        ? turn
        : [EffectTrigger.PostDamage, EffectTrigger.OnCritPostDamage].includes(trigger)
          ? damage
          : use
    const event = variant === 'nested' ? new EffectContext(parent, EffectTrigger.BeforeEffect, source) : parent
    battle.applyEffects<EffectTrigger>(event, trigger, source)
    if (variant === 'repeat') battle.applyEffects<EffectTrigger>(event, trigger, source)
  }
  return {
    admitted,
    removed,
    sourceActive: sourceMark.isActive,
    firstActive: first.isActive,
    secondActive: second.isActive,
    marks: a.team.map(p => p.marks.map(m => [m.baseId, m.isActive])),
    next: battle.random(),
    sourceTarget,
  }
}
for (const id of ids) {
  const d = originals.get(id)!
  const triggers = (Array.isArray(d.trigger) ? d.trigger : [d.trigger]) as EffectTrigger[]
  for (const skillSource of typeof d.apply.target === 'string' || d.apply.target.base === 'mark'
    ? [false]
    : [false, true])
    for (const trigger of triggers)
      for (const variant of variants)
        it(`${id} skillSource=${skillSource} ${trigger} ${variant}`, () => {
          const result = run(true, id, trigger, variant, skillSource)
          expect(result).toEqual(run(false, id, trigger, variant, skillSource))
          if (variant === 'normal' || variant === 'phase') {
            expect(result.admitted).toBe(1)
            expect(result.removed).toEqual(result.sourceTarget ? ['source'] : ['first', 'second'])
          }
          if (variant === 'wrong-owner' && trigger !== EffectTrigger.TurnEnd) expect(result.admitted).toBe(0)
          if (variant === 'noncrit-phase' && trigger === EffectTrigger.OnCritPostDamage) {
            expect(result.admitted).toBe(0)
            expect(result.removed).toEqual([])
          }
          if (variant === 'cancel') {
            expect(result.admitted).toBe(1)
            expect(result.removed).toEqual([])
          }
          if (!result.sourceTarget && variant === 'late-add')
            expect(result.removed).toEqual(['first', 'second', 'late'])
          if (!result.sourceTarget && variant === 'late-owner') expect(result.removed).toEqual(['reserve'])
          if (!result.sourceTarget && variant === 'add-during') {
            expect(result.removed).toEqual(['first', 'second'])
            expect(
              result.marks[0].filter(
                m => m[0] === d.apply.target.chain[0].evaluator.value || m[0] === 'mark_status_fixture',
              ),
            ).toHaveLength(1)
          }
          if (variant === 'indestructible') expect(result.removed).toEqual(result.sourceTarget ? [] : ['second'])
          if (id === 'effect_mark_onDamage_over100_recovery' && variant === 'below-threshold')
            expect(result.admitted).toBe(0)
          if (id === 'effect_mark_onDamage_over100_recovery' && ['late-value', 'at-threshold'].includes(variant)) {
            expect(result.admitted).toBe(1)
            expect(result.removed).toEqual(['source'])
          }
        })
}
it('pins all thirteen source hashes, priorities, triggers and action paths', () => {
  const ledger = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/validation/mark-removals-candidates.json', import.meta.url), 'utf8'),
  )
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
  expect(ledger.records.map((r: { id: string }) => r.id).sort()).toEqual([...ids].sort())
  expect(ids).toHaveLength(13)
  expect(ledger.rejected).toEqual([])
  for (const r of ledger.records) {
    const d = originals.get(r.id)!
    expect(r.definitionSha256).toBe(
      createHash('sha256')
        .update(JSON.stringify(normalize(d)))
        .digest('hex'),
    )
    expect(r.recipe.trigger).toEqual(d.trigger)
    expect(r.recipe.priority).toBe(d.priority)
    expect(r.recipe.actions.map((a: { sourcePath: string }) => a.sourcePath)).toEqual(['/apply'])
    expect(r.recipe.repairedPaths).toEqual([])
  }
})
