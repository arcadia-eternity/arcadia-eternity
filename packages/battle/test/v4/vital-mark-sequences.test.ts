import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedVitalSequences,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  DamageContext,
  HealContext,
  DamagePhase,
  DamageType,
  AttackTargetOpinion,
  executeTurnOperation,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
interface RecordEntry {
  id: keyof typeof generatedVitalSequences
  sourceFile: string
  definitionSha256: string
  recipe: {
    trigger: 'OnDamage' | 'PostDamage' | 'TurnEnd'
    consumesStacks?: number
    repairedPaths: string[]
    actions: { sourcePath: string }[]
  }
}
const allRecords = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/vital-sequences-candidates.json', import.meta.url), 'utf8'),
).records
const records: RecordEntry[] = allRecords.filter(
  (r: { id: string; recipe: { trigger: string } }) =>
    ['TurnEnd', 'OnDamage', 'PostDamage'].includes(r.recipe.trigger) &&
    !['effect_mark_absorb_hp_to_opponent', 'effect_mark_absorb_damage_to_heal'].includes(r.id),
)
const definitions = new Map<string, { id: string; apply: unknown[] }>()
for (const file of new Set(records.map(r => r.sourceFile)))
  for (const d of parse(readFileSync(new URL(`../../../../${file}`, import.meta.url), 'utf8'), { merge: true }))
    definitions.set(d.id, d)
const oracles = new Map(records.map(r => [r.id, EffectParser.parse(definitions.get(r.id))]))
const battles: Battle[] = []
const errors: unknown[][] = []
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
  'one-layer',
  'cancel',
  'late-value',
  'late-owner',
  'late-slot',
  'inactive',
  'wrong-target',
  'wrong-type',
  'late-type',
  'nested',
  'phase',
  'shield',
  'repeat',
  'overkill',
  'zero-damage',
  'late-zero',
] as const
function run(r: RecordEntry, native: boolean, variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(601)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) {
    for (const s of p.skills) s.effects.splice(0)
    p.attributeSystem.updateBaseValue('maxHp', 2001)
    p.currentHp = 1000
  }
  const mark = new BaseMark('fixture/vital-mark' as baseMarkId, [], {
    ...debuff.config,
    maxStacks: 10,
    duration: -1,
  }).createInstance()
  mark.owner = a.activePet
  mark.stack = variant === 'one-layer' ? 1 : 3
  a.activePet.marks.push(mark)
  mark.effects.push(native ? generatedVitalSequences[r.id] : oracles.get(r.id)!)
  if (variant === 'inactive') a.activePet = a.team[1]
  const turn = new TurnContext(battle)
  const selfAttack = r.recipe.trigger === 'PostDamage'
  const attacker = selfAttack ? a : b
  const victim = selfAttack ? b.team[0] : a.team[0]
  const use = new UseSkillContext(
    turn,
    attacker,
    attacker.team[0],
    AttackTargetOpinion.opponent,
    attacker.team[0].skills[0],
  )
  use.updateActualTarget()
  const damage = new DamageContext(
    use,
    attacker.team[0],
    variant === 'wrong-target' ? attacker.team[0] : victim,
    101,
    variant === 'wrong-type' ? DamageType.Physical : DamageType.Special,
  )
  damage.damageResult = variant === 'zero-damage' ? 0 : 101
  if (variant === 'overkill') victim.currentHp = 7
  const hp = () => [...a.team, ...b.team].map(p => p.currentHp)
  const admitted: number[] = []
  const effects: { type: string; value: number; target: number; stack: number }[] = []
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/mark-sequence-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === r.id,
      apply(c) {
        const outer = c.parent as EffectContext<EffectTrigger>
        admitted.push(mark.stack)
        if (variant === 'cancel') outer.available = false
        if (variant === 'late-zero') mark.stack = 0
        if (variant === 'late-value') {
          damage.damageResult = 47
          a.team[0].attributeSystem.updateBaseValue('maxHp', 1001)
        }
        if (variant === 'late-owner') mark.owner = a.team[1]
        if (variant === 'late-slot') b.activePet = b.team[1]
        if (variant === 'late-type') damage.damageType = DamageType.Physical
      },
    }),
  )
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/mark-sequence-events' as effectId,
      triggers: [EffectTrigger.OnDamage, EffectTrigger.OnHeal],
      when: c =>
        (c.parent instanceof DamageContext || c.parent instanceof HealContext) &&
        c.parent.parent instanceof EffectContext &&
        c.parent.parent.effect?.id === r.id,
      apply(c) {
        const event = c.parent
        if (event instanceof DamageContext || event instanceof HealContext)
          effects.push({
            type: event instanceof DamageContext ? 'damage' : 'heal',
            value: event instanceof DamageContext ? event.damageResult : event.healResult,
            target: [...a.team, ...b.team].indexOf(event.target),
            stack: mark.stack,
          })
      },
    }),
  )
  if (variant === 'phase' || variant === 'shield' || variant === 'overkill') {
    let reached = 0
    b.team[1].skills[0].effects.push(
      defineNativeEffect({
        id: 'fixture/stage-probe' as effectId,
        triggers: [EffectTrigger[r.recipe.trigger]],
        when: c =>
          r.recipe.trigger === 'TurnEnd'
            ? c.parent === turn
            : c.parent instanceof DamageContext && c.parent.source === attacker.team[0],
        apply() {
          reached++
        },
      }),
    )
    if (r.recipe.trigger === 'TurnEnd') {
      a.selection = { player: a.id, type: 'do-nothing' }
      b.selection = { player: b.id, type: 'do-nothing' }
      executeTurnOperation(turn, battle)
    } else {
      if (variant === 'shield') {
        const shield = new BaseMark('fixture/shield' as baseMarkId, [], {
          ...debuff.config,
          isShield: true,
          maxStacks: 100,
          duration: -1,
        }).createInstance()
        shield.owner = victim
        shield.stack = 20
        victim.marks.push(shield)
      }
      const phase = new DamagePhase(battle, use, attacker.team[0], victim, 101, DamageType.Special)
      phase.initialize()
      phase.execute()
    }
    expect(reached).toBe(1)
  } else {
    const event = r.recipe.trigger === 'TurnEnd' ? turn : damage
    const parent = variant === 'nested' ? new EffectContext(event, EffectTrigger.BeforeEffect, mark) : event
    battle.applyEffects<EffectTrigger>(parent, EffectTrigger[r.recipe.trigger], mark)
    if (variant === 'repeat') battle.applyEffects<EffectTrigger>(parent, EffectTrigger[r.recipe.trigger], mark)
  }
  return {
    hp: hp(),
    admitted,
    effects,
    source: {
      stack: mark.stack,
      active: mark.isActive,
      owner: mark.owner ? [...a.team, ...b.team].indexOf(mark.owner as typeof a.activePet) : -1,
    },
    next: battle.random(),
  }
}
for (const r of records) {
  it(`${r.id} audits unchanged YAML and full action list`, () => {
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
    expect(r.recipe.repairedPaths).toEqual([])
    expect(r.recipe.actions.map(a => a.sourcePath)).toEqual(definitions.get(r.id)!.apply.map((_, i) => `/apply/${i}`))
  })
  for (const variant of variants)
    it(`${r.id} ${variant}`, () => {
      const actual = run(r, true, variant)
      expect(actual).toEqual(run(r, false, variant))
      const heal = r.recipe.trigger === 'TurnEnd'
      const divisor = r.id.includes('_1_16') ? 16 : r.id.includes('_1_8') ? 8 : 6
      const damageAmount = (n: number) =>
        r.id.includes('mihuo')
          ? n
          : r.id.includes('_1_4')
            ? Math.floor(n / 4)
            : r.id.includes('special')
              ? Math.floor(n * 0.5)
              : Math.floor(n * 1.5)
      if (variant === 'normal' || variant === 'phase' || variant === 'shield' || (variant === 'overkill' && !heal)) {
        expect(actual.admitted).toHaveLength(1)
        const amount = heal ? Math.floor(2001 / divisor) : damageAmount(variant === 'shield' ? 81 : 101)
        const target = heal || r.id.includes('mihuo') ? 0 : 2
        expect(actual.effects).toEqual([
          { type: heal ? 'heal' : 'damage', value: amount, target, stack: r.recipe.consumesStacks ? 2 : 3 },
        ])
        expect(actual.hp[target]).toBe(1000 + (heal ? amount : -amount))
      }
      if (variant === 'cancel') {
        expect(actual.effects).toEqual([])
        expect(actual.source.stack).toBe(3)
      }
      if (variant === 'one-layer' && r.recipe.consumesStacks) {
        expect(actual.effects).toEqual([])
        expect(actual.source.active).toBe(false)
      }
      if (variant === 'late-value')
        expect(actual.effects[0].value).toBe(heal ? Math.floor(1001 / divisor) : damageAmount(47))
      if (variant === 'wrong-type' && r.id.includes('special')) expect(actual.admitted).toEqual([])
      if (variant === 'late-type' && r.id.includes('special')) expect(actual.effects).toHaveLength(1)
      if (variant === 'overkill' && !heal) expect(actual.hp[r.id.includes('mihuo') ? 2 : 0]).toBe(0)
      if (variant === 'zero-damage' && !heal) expect(actual.hp).toEqual([1000, 1000, 1000, 1000])
      if (variant === 'late-zero' && r.recipe.consumesStacks) expect(actual.effects).toEqual([])
      if (variant === 'late-slot' && !heal && !r.id.includes('mihuo')) expect(actual.effects[0].target).toBe(3)
    })
}
it('exports exactly the full vital ledger', () =>
  expect(Object.keys(generatedVitalSequences).sort()).toEqual(allRecords.map((r: { id: string }) => r.id).sort()))
