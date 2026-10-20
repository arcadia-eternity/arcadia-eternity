import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedVitalSequences,
  effectAuthoring,
  parameterAddress,
  BaseMark,
  BaseSkill,
  SkillInstance,
  Category,
  Element,
  AttackTargetOpinion,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  DamageContext,
  DamagePhase,
  DamageType,
  RageContext,
  SkillPhase,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type baseSkillId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const id = 'effect_skill_clear_rage_add_fixed_damage'
const original = parse(
  readFileSync(new URL('../../../../packs/base/data/effect_skill.yaml', import.meta.url), 'utf8'),
  { merge: true },
).find((d: { id: string }) => d.id === id)
const oracle = EffectParser.parse(original)
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
  'zero',
  'cancel',
  'late-rage',
  'late-owner',
  'late-config',
  'config-half',
  'config-zero',
  'other-skill',
  'opponent-use',
  'nested',
  'between-rage',
  'between-owner',
  'between-detach',
  'rage-cancel',
  'rage-modified',
  'rage-callback',
  'repeat',
  'phase',
  'skill-phase',
  'preexisting',
] as const
function run(native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(811)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) {
    for (const s of p.skills) s.effects.splice(0)
    p.attributeSystem.updateBaseValue('maxHp', 2001)
    p.currentHp = 2001
  }
  const skill = new SkillInstance(
    new BaseSkill(
      'fixture/rage-damage' as baseSkillId,
      Category.Physical,
      Element.Normal,
      40,
      100,
      0,
      0,
      AttackTargetOpinion.opponent,
      1,
      true,
    ),
  )
  skill.owner = a.activePet
  a.activePet.skills[0] = skill
  battle.skillMap.set(skill.id, skill)
  const mark = new BaseMark('fixture/rage-damage' as baseMarkId, [], {
    ...debuff.config,
    duration: -1,
  }).createInstance()
  mark.owner = a.activePet
  a.activePet.marks.push(mark)
  const source = kind === 'skill' ? skill : mark
  const effect = native ? generatedVitalSequences[id] : oracle
  if (native) effectAuthoring.effectParameters(effect).install(battle.configSystem)
  source.effects.push(effect)
  const key = native ? parameterAddress(id, 'parameters', 'action0_value_delta_step1') : `${id}.multiply_value`
  if (variant === 'config-half') battle.configSystem.set(key, 0.5)
  if (variant === 'config-zero') battle.configSystem.set(key, 0)
  a.currentRage = variant === 'zero' ? 0 : 31
  b.currentRage = 19
  const turn = new TurnContext(battle)
  const actor = variant === 'opponent-use' ? b : a
  const use = new UseSkillContext(
    turn,
    actor,
    actor.activePet,
    AttackTargetOpinion.opponent,
    variant === 'other-skill' ? a.team[1].skills[0] : actor.activePet.skills[0],
  )
  use.updateActualTarget()
  let damage = new DamageContext(
    use,
    actor.activePet,
    actor === a ? b.activePet : a.activePet,
    100,
    DamageType.Physical,
  )
  if (variant === 'preexisting') damage.modified = [20, 7]
  let admitted = 0
  const modifications: { percent: number; delta: number; rage: number[] }[] = []
  const rageEvents: { value: number; target: string; modifiedType: string; delta: number; before: number[] }[] = []
  const wrapped = new WeakSet<DamageContext>()
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/rage-damage-before' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        const outer = c.parent as EffectContext<EffectTrigger>
        admitted++
        if (outer.parent instanceof DamageContext) damage = outer.parent
        if (variant === 'cancel') outer.available = false
        if (variant === 'late-rage') a.currentRage = 9
        if (variant === 'late-owner') source.owner = b.activePet
        if (variant === 'late-config') battle.configSystem.set(key, 0.5)
        if (!wrapped.has(damage)) {
          wrapped.add(damage)
          const add = damage.addModified.bind(damage)
          // Test seam: mutate state after the first domain write, before the next authored action.
          damage.addModified = (percent, delta) => {
            add(percent, delta)
            modifications.push({ percent, delta, rage: [a.currentRage, b.currentRage] })
            if (variant === 'between-rage') a.currentRage = 9
            if (variant === 'between-owner') source.owner = b.activePet
            if (variant === 'between-detach') source.owner = null
          }
        }
      },
    }),
  )
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/rage-damage-rage' as effectId,
      triggers: [EffectTrigger.BeforeRageGain, EffectTrigger.BeforeRageLoss],
      when: c =>
        c.parent instanceof RageContext &&
        c.parent.parent instanceof EffectContext &&
        c.parent.parent.effect?.id === id,
      apply(c) {
        const event = c.parent as RageContext
        rageEvents.push({
          value: event.value,
          target: event.target === a ? 'a' : 'b',
          modifiedType: event.modifiedType,
          delta: damage.modified[1],
          before: [a.currentRage, b.currentRage],
        })
        if (variant === 'rage-cancel') event.available = false
        if (variant === 'rage-modified') event.addModified(-50, 0)
        if (variant === 'rage-callback') a.currentRage = 50
      },
    }),
  )
  if (variant === 'phase' || variant === 'skill-phase') {
    let reached = 0
    b.team[1].skills[0].effects.push(
      defineNativeEffect({
        id: 'fixture/rage-damage-probe' as effectId,
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        when: c => c.parent instanceof DamageContext && c.parent.source === a.activePet,
        apply() {
          reached++
        },
      }),
    )
    const phase =
      variant === 'phase'
        ? new DamagePhase(battle, use, a.activePet, b.activePet, 100, DamageType.Physical)
        : new SkillPhase(battle, a, a.activePet, AttackTargetOpinion.opponent, skill, turn, use)
    phase.initialize()
    phase.execute()
    expect(reached).toBe(1)
  } else {
    const parent = variant === 'nested' ? new EffectContext(damage, EffectTrigger.BeforeEffect, source) : damage
    battle.applyEffects<EffectTrigger>(parent, EffectTrigger.OnBeforeCalculateDamage, source)
    if (variant === 'repeat') battle.applyEffects<EffectTrigger>(parent, EffectTrigger.OnBeforeCalculateDamage, source)
    damage.updateDamageResult()
  }
  return {
    admitted,
    modifications,
    rageEvents,
    modified: damage.modified,
    result: damage.damageResult,
    rage: [a.currentRage, b.currentRage],
    hp: [a.activePet.currentHp, b.activePet.currentHp],
    next: battle.random(),
  }
}
for (const kind of ['skill', 'mark'] as const)
  for (const variant of variants)
    it(`rage conversion ${kind} ${variant}`, () => {
      const actual = run(true, kind, variant)
      expect(actual).toEqual(run(false, kind, variant))
      const rejected = variant === 'opponent-use' || (variant === 'other-skill' && kind === 'skill')
      if (rejected || variant === 'cancel') {
        expect(actual.modifications).toEqual([])
        expect(actual.rageEvents).toEqual([])
        return
      }
      expect(actual.admitted).toBe(variant === 'repeat' ? 2 : 1)
      const delta =
        variant === 'zero' || variant === 'config-zero'
          ? 0
          : variant === 'late-rage'
            ? 9
            : variant === 'late-owner'
              ? 19
              : ['late-config', 'config-half'].includes(variant)
                ? 15
                : 31
      expect(actual.modifications[0].delta).toBe(delta)
      if (variant === 'between-detach') {
        expect(actual.rageEvents).toEqual([])
        expect(actual.rage).toEqual([31, 19])
        return
      }
      const ownerChanged = variant === 'late-owner' || variant === 'between-owner'
      const value = ownerChanged
        ? -19
        : variant === 'between-rage' || variant === 'late-rage'
          ? -9
          : variant === 'zero'
            ? -0
            : -31
      expect(actual.rageEvents[0]).toMatchObject({
        value,
        target: ownerChanged ? 'b' : 'a',
        modifiedType: 'add',
        delta: delta + (variant === 'preexisting' ? 7 : 0),
      })
      if (!['phase', 'skill-phase'].includes(variant))
        expect(actual.rage).toEqual(
          ownerChanged
            ? [31, 0]
            : [
                variant === 'rage-cancel'
                  ? 31
                  : variant === 'rage-modified'
                    ? 15
                    : variant === 'rage-callback'
                      ? 19
                      : 0,
                19,
              ],
        )
      if (variant === 'normal') expect(actual.modified).toEqual([0, 31])
      if (variant === 'repeat') expect(actual.modifications.map(m => m.delta)).toEqual([31, 0])
      if (variant === 'phase') {
        expect(actual.result).toBe(131)
        expect(actual.hp[1]).toBe(1870)
      }
      if (variant === 'preexisting') {
        expect(actual.modified).toEqual([20, 38])
        expect(actual.result).toBe(158)
      }
    })
it('pins source, aliases and full action order', () => {
  const ledger = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/validation/vital-sequences-candidates.json', import.meta.url), 'utf8'),
  )
  const record = ledger.records.find((r: { id: string }) => r.id === id)
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
  expect(record.definitionSha256).toBe(
    createHash('sha256')
      .update(JSON.stringify(normalize(original)))
      .digest('hex'),
  )
  expect(record.recipe.actions.map((a: { sourcePath: string }) => a.sourcePath)).toEqual(['/apply/0', '/apply/1'])
  expect(record.recipe.parameters).toEqual([
    { name: 'action0_value_delta_step1', value: 1, configId: 'multiply_value' },
  ])
  expect(record.recipe.repairedPaths).toEqual([])
})
