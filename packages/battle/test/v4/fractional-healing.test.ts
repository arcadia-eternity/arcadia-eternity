import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  BattleMessageType,
  effectAuthoring,
  parameterAddress,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type BattleMessage,
  type BaseBattleMessage,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createFractionalHealing } from '@arcadia-eternity/data-pack-base/native'

const candidates = createFractionalHealing()
const definitions = parse(
  readFileSync(new URL('./fixtures/effect-regression/effect_skill.yaml', import.meta.url), 'utf8'),
  { merge: true },
) as { id: string }[]
const oracles = new Map(
  Object.keys(candidates).map(id => [id, EffectParser.parse(definitions.find(d => d.id === id)!)]),
)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  vi.restoreAllMocks()
  for (const b of battles.splice(0)) await b.cleanup()
})
const variants = [
  'normal',
  'custom',
  'negative',
  'late-divisor',
  'late-maxHp',
  'missing-support',
  'wrong-owner',
  'nested',
  'cancel-effect',
  'cancel-heal',
  'repeat',
] as const
function run(
  id: keyof typeof candidates,
  native: boolean,
  kind: 'skill' | 'mark',
  variant: (typeof variants)[number] | 'zero' | 'overflow',
) {
  const f = makeScenario(51),
    { battle, a, b, debuff } = f
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const owner = a.activePet,
    skill = owner.skills[0]
  owner.attributeSystem.updateBaseValue('maxHp', 241)
  owner.currentHp = 1
  const add = (id: string) => {
    const m = new BaseMark(id as baseMarkId, [], debuff.config).createInstance()
    m.setOwner(owner, battle.emitter)
    owner.marks.push(m)
    return m
  }
  const source = kind === 'skill' ? skill : add('fixture/fraction-source')
  if (variant !== 'missing-support') add('mark_guanghuilingyu')
  const effect = native ? candidates[id] : oracles.get(id)!
  if (native) effectAuthoring.effectParameters(effect).install(battle.configSystem)
  const keys = battle.configSystem.getRegisteredKeys().filter(key => key.startsWith(`${id}.`))
  if (!native) expect(keys).toHaveLength(1)
  const key = native ? parameterAddress(id, 'parameters', 'divisor') : keys[0]
  if (variant === 'custom') battle.configSystem.set(key, 2.5)
  if (variant === 'negative') battle.configSystem.set(key, -2)
  if (variant === 'zero') battle.configSystem.set(key, 0)
  if (variant === 'overflow') battle.configSystem.set(key, Number.MIN_VALUE)
  source.effects.push(effect)
  const before: number[] = [],
    after: number[] = []
  b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/fraction-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnBeforeHeal, EffectTrigger.OnHeal],
      when: ctx =>
        ctx.trigger !== EffectTrigger.BeforeEffect ||
        (ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id),
      apply: ctx => {
        if (ctx.trigger === EffectTrigger.BeforeEffect && ctx.parent instanceof EffectContext) {
          if (variant === 'cancel-effect') ctx.parent.available = false
          if (variant === 'late-divisor') battle.configSystem.set(key, 3)
          if (variant === 'late-maxHp') owner.attributeSystem.updateBaseValue('maxHp', 251)
        }
        if (ctx.trigger === EffectTrigger.OnBeforeHeal) {
          before.push(ctx.parent.baseHeal)
          if (variant === 'cancel-heal') ctx.parent.available = false
        }
        if (ctx.trigger === EffectTrigger.OnHeal) after.push(ctx.parent.healResult)
      },
    }),
  )
  const on = id.includes('on_defeat') ? EffectTrigger.OnDefeat : EffectTrigger.OnHit
  const use = new UseSkillContext(
    new TurnContext(battle),
    a,
    variant === 'wrong-owner' ? a.team[1] : owner,
    AttackTargetOpinion.opponent,
    skill,
  )
  const parent = variant === 'nested' ? new EffectContext(use, on, source) : use
  let failures = 0
  battle.registerListener(message => {
    // The runtime supports this message, but the public union currently omits it.
    const event = message as BattleMessage | BaseBattleMessage<BattleMessageType.EffectApplyFail>
    if (event.type === BattleMessageType.EffectApplyFail && event.data.effect === id) failures++
  })
  if (native && (variant === 'zero' || variant === 'overflow'))
    expect(() => battle.executionBudget.run(0, () => effect.innerApply(new EffectContext(use, on, source)))).toThrow(
      'Expected finite numeric input',
    )
  battle.applyEffects(parent, on as EffectTrigger, source)
  if (variant === 'repeat') battle.applyEffects(parent, on as EffectTrigger, source)
  return { before, after, hp: owner.currentHp, failures, next: battle.random() }
}
for (const id of Object.keys(candidates) as (keyof typeof candidates)[])
  for (const kind of ['skill', 'mark'] as const) {
    for (const variant of variants)
      it(`${id} ${kind} ${variant}`, () => {
        const actual = run(id, true, kind, variant)
        expect(actual).toEqual(run(id, false, kind, variant))
        if (variant === 'normal') {
          const amount = Math.floor(241 / (id.includes('quarter') ? 4 : 6))
          expect(actual.before).toEqual([amount])
          expect(actual.hp).toBe(1 + amount)
        }
        if (variant === 'custom') expect(actual.before).toEqual([96])
        if (variant === 'negative') {
          expect(actual.before).toEqual([-121])
          expect(actual.hp).toBe(1)
        }
        if (variant === 'late-divisor') expect(actual.before).toEqual([80])
        if (variant === 'cancel-heal') {
          expect(actual.before).toHaveLength(1)
          expect(actual.after).toEqual([])
          expect(actual.hp).toBe(1)
        }
      })
    for (const invalid of ['zero', 'overflow'] as const)
      it(`${id} ${kind} ${invalid} divisor has an explicit finite-input correction`, () => {
        const native = run(id, true, kind, invalid),
          legacy = run(id, false, kind, invalid)
        expect(native.before).toEqual([])
        expect(native.hp).toBe(1)
        expect(native.failures).toBe(1)
        expect(legacy.before).toEqual([Infinity])
        expect(legacy.hp).toBe(241)
        expect(legacy.failures).toBe(0)
      })
  }
