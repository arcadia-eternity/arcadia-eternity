import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  AttackTargetOpinion,
  BaseMark,
  BattleMessageType,
  DamageContext,
  DamageType,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
  type Pet,
} from '@arcadia-eternity/battle/engine'
import { makeScenario } from './scenario'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})

function fixture() {
  const { battle, a, b, debuff } = makeScenario(65)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const caster = a.activePet
  const target = b.activePet
  const skill = caster.skills[0]
  const use = new UseSkillContext(new TurnContext(battle), a, caster, AttackTargetOpinion.opponent, skill)
  function hit(amount: number, type = DamageType.Physical) {
    const event = new DamageContext(use, skill, target, amount, type)
    target.damage(event)
    expect(event.result).toBeDefined()
    return event
  }
  function mark(owner: Pet, stack: number, isShield = false) {
    const base = new BaseMark('fixture/resource' as baseMarkId, [], { ...debuff.config, maxStacks: 100, isShield })
    const mark = base.createInstance({ stack })
    mark.setOwner(owner, battle.emitter)
    owner.marks.push(mark)
    return mark
  }
  return { battle, caster, target, skill, use, hit, mark }
}

it('records the proposed amount, summed percent modifiers, flat deltas and final HP loss independently', () => {
  const { hit, target, skill } = fixture()
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/scale' as effectId,
      triggers: [EffectTrigger.OnBeforeCalculateDamage],
      apply({ parent }) {
        parent.addModified(50, -2)
        parent.addModified(25, 3)
      },
    }),
  )
  const hpBefore = target.currentHp
  const event = hit(20)
  expect(event.result).toMatchObject({
    status: 'committed',
    originalDamage: 20,
    modifiedDamage: 36,
    preventedDamage: 0,
    hpLoss: 36,
    hpBefore,
    hpAfter: hpBefore - 36,
  })
  expect(target.currentHp).toBe(hpBefore - 36)
  expect(Object.isFrozen(event.result)).toBe(true)
  expect(Object.isFrozen(event.result!.origin)).toBe(true)
  expect(Object.isFrozen(event.result!.trace)).toBe(true)
})

it('reports overkill after shield absorption and records only the HP actually lost', () => {
  const { hit, target, battle, mark } = fixture()
  mark(target, 7, true)
  const defeats: string[] = []
  const damage: number[] = []
  battle.registerListener(message => {
    if (message.type === BattleMessageType.PetDefeated) defeats.push(message.data.pet)
    if (message.type === BattleMessageType.Damage) damage.push(message.data.damage)
  })
  const hp = target.currentHp
  const event = hit(hp + 47)
  expect(event.result).toMatchObject({
    modifiedDamage: hp + 47,
    dealtDamage: hp + 40,
    hpLoss: hp,
    hpAfter: 0,
    preventedDamage: 7,
  })
  expect(damage).toEqual([hp + 40])
  expect(event.damageResult).toBe(hp + 40)
  expect(target.currentHp).toBe(0)
  expect(hit(10, DamageType.Effect).result).toMatchObject({ status: 'failed', dealtDamage: 0, hpLoss: 0 })
  expect(defeats).toEqual([target.id])
})

it.each([
  [8, 12],
  [20, 0],
  [28, 0],
])('absorbs a 20-point hit using a %i-point shield', (stack, loss) => {
  const { hit, target, mark, skill } = fixture()
  const shield = mark(target, stack, true)
  let reactions = 0
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/observe-damage' as effectId,
      triggers: [EffectTrigger.OnDamage],
      apply() {
        reactions++
      },
    }),
  )
  const event = hit(20)
  expect(event.result).toMatchObject({ shieldAbsorbed: 20 - loss, preventedDamage: 20 - loss, hpLoss: loss })
  expect(event.result!.payments).toEqual([{ markId: shield.id, stacks: 20 - loss, reason: 'shield' }])
  expect(Object.isFrozen(event.result!.payments[0])).toBe(true)
  expect(shield.stack).toBe(Math.max(0, stack - 20))
  expect(reactions).toBe(loss > 0 ? 1 : 0)
})

it('reconsiders target-bound rules after redirection and uses a redirect only once', () => {
  const { hit, caster, target, skill } = fixture()
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/redirect' as effectId,
      triggers: [EffectTrigger.OnDamageReplacement],
      apply({ parent }) {
        parent.addRule({ id: 'redirect', priority: 30, change: { kind: 'redirect', target: caster } })
        if (parent.target === caster)
          parent.addRule({ id: 'caster-barrier', priority: 10, change: { kind: 'prevent', amount: 6 } })
        if (parent.target === target)
          parent.addRule({ id: 'original-barrier', priority: 10, change: { kind: 'prevent', amount: 19 } })
      },
    }),
  )
  const hp = target.currentHp
  const casterHp = caster.currentHp
  const event = hit(20)
  expect(event.result).toMatchObject({ targetId: caster.id, preventedDamage: 6, hpLoss: 14 })
  expect(event.result!.trace.map(entry => [entry.kind, entry.id])).toEqual([
    ['redirect', 'redirect'],
    ['prevent', 'caster-barrier'],
  ])
  expect(target.currentHp).toBe(hp)
  expect(caster.currentHp).toBe(casterHp - 14)
})

it('reserves affordable costs in priority order without spending the same stacks twice', () => {
  const { hit, target, mark, skill } = fixture()
  const resource = mark(target, 3)
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/shared-defense' as effectId,
      triggers: [EffectTrigger.OnDamageReplacement],
      apply({ parent }) {
        const cost = { mark: resource, stacks: 2 }
        parent.addRule({ id: 'low', priority: 1, change: { kind: 'prevent', amount: 7 }, cost })
        parent.addRule({ id: 'high', priority: 9, change: { kind: 'prevent', fraction: 0.5 }, cost })
      },
    }),
  )
  expect(hit(20).result).toMatchObject({ hpLoss: 10, preventedDamage: 10 })
  expect(resource.stack).toBe(1)
  expect(hit(20).result).toMatchObject({ hpLoss: 20, preventedDamage: 0 })
  expect(resource.stack).toBe(1)
})

it('cancels before any success-only cost or HP commit', () => {
  const { hit, target, mark, skill } = fixture()
  const resource = mark(target, 3)
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/cancelled' as effectId,
      triggers: [EffectTrigger.OnBeforeCalculateDamage],
      apply({ parent }) {
        parent.reserveModifierCost(resource, 2)
        parent.available = false
      },
    }),
  )
  const hp = target.currentHp
  expect(hit(20).result).toMatchObject({ status: 'cancelled', hpLoss: 0 })
  expect(resource.stack).toBe(3)
  expect(target.currentHp).toBe(hp)
})

it('converts damage to healing without damage reactions or shield loss', () => {
  const { hit, target, mark, skill } = fixture()
  const shield = mark(target, 12, true)
  target.currentHp -= 25
  const hp = target.currentHp
  const triggers: EffectTrigger[] = []
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/absorb' as effectId,
      triggers: [EffectTrigger.OnDamageReplacement, EffectTrigger.OnDamage, EffectTrigger.OnHeal],
      apply(ctx) {
        if (ctx.trigger === EffectTrigger.OnDamageReplacement)
          ctx.parent.addRule({ id: 'absorb', change: { kind: 'heal', source: ctx, fraction: 0.5 } })
        else triggers.push(ctx.trigger)
      },
    }),
  )
  expect(hit(20).result).toMatchObject({
    status: 'replaced',
    hpBefore: hp,
    hpAfter: hp + 10,
    hpLoss: 0,
    shieldAbsorbed: 0,
  })
  expect(target.currentHp).toBe(hp + 10)
  expect(triggers).toEqual([EffectTrigger.OnHeal])
  expect(shield.stack).toBe(12)
})

it('applies a survival replacement only to lethal damage', () => {
  const { hit, target, mark, skill } = fixture()
  const resource = mark(target, 2)
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/endure' as effectId,
      triggers: [EffectTrigger.OnDamageReplacement],
      apply({ parent }) {
        parent.addRule({ id: 'endure', change: { kind: 'survive', hp: 1 }, cost: { mark: resource, stacks: 1 } })
      },
    }),
  )
  expect(hit(5).result!.hpLoss).toBe(5)
  expect(resource.stack).toBe(2)
  const remaining = target.currentHp
  expect(hit(remaining + 10).result).toMatchObject({ hpBefore: remaining, hpAfter: 1, hpLoss: remaining - 1 })
  expect(resource.stack).toBe(1)
  expect(target.isAlive).toBe(true)
})

it('uses stable declaration order for two equally prioritized preventions', () => {
  const { hit, skill } = fixture()
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/prevention-order' as effectId,
      triggers: [EffectTrigger.OnDamageReplacement],
      apply({ parent }) {
        parent.addRule({ id: 'z-first', change: { kind: 'prevent', amount: 10 } })
        parent.addRule({ id: 'a-second', change: { kind: 'prevent', fraction: 0.5 } })
      },
    }),
  )
  expect(hit(30).result).toMatchObject({ preventedDamage: 20, hpLoss: 10 })
})

it('cannot edit or recommit the event after applying its HP loss', () => {
  const { hit, target, skill } = fixture()
  const event = hit(7)
  const committed = event.result!
  const remaining = target.currentHp
  expect(Object.isFrozen(event)).toBe(true)
  expect(() => event.addModified(100, 0)).toThrow()
  expect(Reflect.set(committed, 'hpLoss', 99)).toBe(false)
  expect(() => target.damage(event)).toThrow()
  expect(event.result).toBe(committed)
  expect(event.damageResult).toBe(7)
  expect(event.source.id).toBe(skill.id)
  expect(target.currentHp).toBe(remaining)
})

it('releases a replacement cost when the proposed heal is denied', () => {
  const { hit, target, skill, mark } = fixture()
  const resource = mark(target, 4)
  target.currentHp -= 10
  const before = target.currentHp
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/unavailable-heal' as effectId,
      triggers: [EffectTrigger.OnDamageReplacement, EffectTrigger.OnBeforeHeal],
      apply(ctx) {
        if (ctx.trigger === EffectTrigger.OnBeforeHeal) {
          ctx.parent.available = false
          return
        }
        ctx.parent.addRule({
          id: 'convert',
          cost: { mark: resource, stacks: 2 },
          change: { kind: 'heal', source: ctx },
        })
      },
    }),
  )
  expect(hit(20).result).toMatchObject({ status: 'failed', reason: 'heal-failed', hpLoss: 0 })
  expect(target.currentHp).toBe(before)
  expect(resource.stack).toBe(4)
})

it('pays for an accepted numeric modifier that reduces a positive hit to zero', () => {
  const { hit, target, mark, skill } = fixture()
  const resource = mark(target, 2)
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/paid-reduction' as effectId,
      triggers: [EffectTrigger.OnBeforeCalculateDamage],
      apply({ parent }) {
        if (parent.reserveModifierCost(resource, 2)) parent.addModified(-100, 0)
      },
    }),
  )
  expect(hit(20).result).toMatchObject({ status: 'committed', modifiedDamage: 0, hpLoss: 0 })
  expect(resource.stack).toBe(0)
  expect(hit(20).result!.hpLoss).toBe(20)
})

it.each([false, true])('rechecks replacements between shield debits and releases them on a heal veto (%s)', veto => {
  const { target, hit, mark, skill } = fixture()
  const first = mark(target, 30, true)
  const second = mark(target, 40, true)
  target.currentHp = 1
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/partial-absorption' as effectId,
      triggers: [EffectTrigger.OnDamageReplacement, EffectTrigger.OnBeforeHeal],
      apply(ctx) {
        if (ctx.trigger === EffectTrigger.OnBeforeHeal) {
          ctx.parent.available = !veto
        } else if (ctx.parent.damageResult <= 50) {
          ctx.parent.addRule({ id: 'convert', change: { kind: 'heal', source: ctx } })
        }
      },
    }),
  )
  const result = hit(80).result!
  expect(result).toMatchObject({
    status: veto ? 'failed' : 'replaced',
    hpBefore: 1,
    hpAfter: veto ? 1 : 51,
    hpLoss: 0,
    preventedDamage: veto ? 0 : 30,
    shieldAbsorbed: veto ? 0 : 30,
  })
  expect(result.payments).toEqual(veto ? [] : [{ markId: first.id, stacks: 30, reason: 'shield' }])
  expect(first.stack).toBe(veto ? 30 : 0)
  expect(second.stack).toBe(40)
  expect(target.currentHp).toBe(result.hpAfter)
})

it('rechecks authored Shield and replacement rules after each partial absorption', () => {
  const { target, hit, mark, skill } = fixture()
  const first = mark(target, 30, true)
  const second = mark(target, 40, true)
  target.currentHp = 1
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/shield-threshold' as effectId,
      triggers: [EffectTrigger.Shield, EffectTrigger.OnDamageReplacement],
      apply(ctx) {
        if (ctx.trigger === EffectTrigger.Shield && ctx.parent.damageResult <= 50)
          ctx.parent.addRule({ id: 'ward', change: { kind: 'prevent', amount: 20 } })
        if (ctx.trigger === EffectTrigger.OnDamageReplacement && ctx.parent.damageResult <= 30)
          ctx.parent.addRule({ id: 'convert', change: { kind: 'heal', source: ctx } })
      },
    }),
  )
  const result = hit(80).result!
  expect(result).toMatchObject({
    status: 'replaced',
    preventedDamage: 50,
    shieldAbsorbed: 30,
    hpLoss: 0,
    hpAfter: 31,
  })
  expect(result.trace.map(({ kind, id, before, after }) => [kind, id, before, after])).toEqual([
    ['shield', first.id, 80, 50],
    ['prevent', 'ward', 50, 30],
    ['heal', 'convert', 30, 0],
  ])
  expect(first.stack).toBe(0)
  expect(second.stack).toBe(40)
})
