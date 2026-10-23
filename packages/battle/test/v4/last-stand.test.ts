import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  parameterAddress,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  DamageContext,
  ConsumeStackContext,
  DamageType,
  BattleMessageType,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createLastStand } from '@arcadia-eternity/data-pack-base/native'

const id = 'effect_mark_set_health_to_1_on_damage'
const definition = (
  parse(readFileSync(new URL('./fixtures/effect-regression/effect_mark.yaml', import.meta.url), 'utf8'), {
    merge: true,
  }) as { id: string }[]
).find(d => d.id === id)!
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'zero',
  'positive',
  'wrong-target',
  'last-stack',
  'cancel-consume',
  'cancel-effect',
  'late-hp',
  'suppressed',
  'physical',
  'special',
  'effect',
] as const
function run(native: boolean, kind: 'mark' | 'skill', variant: (typeof variants)[number], health?: number) {
  const { battle, a, b, debuff } = makeScenario(780)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const owner = a.activePet
  const mark = new BaseMark('fixture/last-stand' as baseMarkId, [], {
    ...debuff.config,
    maxStacks: 10,
    persistent: true,
    duration: -1,
  }).createInstance()
  mark.setOwner(owner, battle.emitter)
  mark.stack = variant === 'last-stack' ? 1 : 3
  mark.isSuppressed = variant === 'suppressed'
  owner.marks.push(mark)
  const source = kind === 'mark' ? mark : owner.skills[0]
  const effect = native ? createLastStand()[id] : EffectParser.parse(definition)
  if (native) effectAuthoring.effectParameters(effect).install(battle.configSystem)
  if (health !== undefined) battle.configSystem.set(parameterAddress(id, 'parameters', 'health'), health)
  source.effects.push(effect)
  owner.currentHp = variant === 'positive' ? 2 : ['physical', 'special', 'effect'].includes(variant) ? 20 : 0
  const context = new DamageContext(
    new EffectContext(new TurnContext(battle), EffectTrigger.PostDamage as EffectTrigger, source),
    b.activePet.skills[0],
    variant === 'wrong-target' ? b.activePet : owner,
    20,
    variant === 'special' ? DamageType.Special : variant === 'effect' ? DamageType.Effect : DamageType.Physical,
  )
  let applications = 0
  const trace: unknown[] = []
  b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/last-stand-observer' as effectId,
      triggers: [
        EffectTrigger.BeforeEffect,
        EffectTrigger.AfterEffect,
        EffectTrigger.OnBeforeConsumeStack,
        EffectTrigger.OnConsumeStack,
      ],
      when: ctx =>
        ctx.parent instanceof ConsumeStackContext ||
        (ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id),
      apply: ctx => {
        trace.push([ctx.trigger, owner.currentHp, mark.stack])
        if (ctx.parent instanceof ConsumeStackContext && variant === 'cancel-consume') ctx.parent.available = false
        if (ctx.parent instanceof EffectContext && ctx.trigger === EffectTrigger.BeforeEffect) {
          applications++
          if (variant === 'cancel-effect') ctx.parent.available = false
          if (variant === 'late-hp') owner.currentHp = 7
        }
      },
    }),
  )
  battle.registerListener(message => {
    if (message.type === BattleMessageType.Heal) trace.push('heal')
    if (message.type === BattleMessageType.MarkUpdate && message.data.mark.id === mark.id)
      trace.push(['stack', message.data.mark.stack])
  })
  if (['physical', 'special', 'effect'].includes(variant)) owner.damage(context)
  else battle.applyEffects(context, EffectTrigger.PostDamage, source)
  return {
    hp: owner.currentHp,
    stack: mark.stack,
    active: mark.isActive,
    attached: mark.owner === owner,
    applications,
    trace,
    next: battle.random(),
  }
}
for (const kind of ['mark', 'skill'] as const)
  for (const variant of variants)
    it(`${kind} ${variant}`, () => {
      const actual = run(true, kind, variant)
      expect(actual).toEqual(run(false, kind, variant))
      const admitted =
        !['positive', 'wrong-target', 'effect'].includes(variant) && !(kind === 'mark' && variant === 'suppressed')
      expect(actual.applications).toBe(admitted ? 1 : 0)
      const consumed = kind === 'mark' && admitted && !['cancel-effect', 'cancel-consume'].includes(variant)
      expect(actual.stack).toBe((variant === 'last-stack' ? 1 : 3) - Number(consumed))
      if (admitted && variant !== 'cancel-effect')
        expect(actual.hp).toBe(kind === 'mark' && variant === 'last-stack' ? 0 : 1)
      expect(actual.trace).not.toContain('heal')
    })

for (const health of [3, 8])
  it(`reads configured HP ${health} at execution`, () => {
    expect(run(true, 'mark', 'zero', health).hp).toBe(health)
  })
