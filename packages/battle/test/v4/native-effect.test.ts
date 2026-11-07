import { afterEach, beforeAll, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  defineNativeEffect,
  nativeEffectTriggers,
  EffectTrigger,
  EffectContext,
  TurnContext,
  DamageContext,
  setGlobalLogger,
  type Battle,
  type effectId,
  type NativeEffectContext,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})

it('uses correlated contexts through the real condition and effect execution chain', () => {
  const { battle, a, b } = makeScenario()
  battles.push(battle)
  const source = a.activePet.skills[0]
  const events: string[] = []
  const triggers = [EffectTrigger.TurnStart, EffectTrigger.OnDamage] as const
  const definition = {
    id: 'native/context' as effectId,
    triggers,
    when(ctx: NativeEffectContext<(typeof triggers)[number]>) {
      events.push(`when:${ctx.parent.type}`)
      return ctx.trigger === EffectTrigger.TurnStart || ctx.parent.baseDamage > 0
    },
    apply(ctx: NativeEffectContext<(typeof triggers)[number]>) {
      if (ctx.trigger === EffectTrigger.OnDamage) {
        const damage: DamageContext = ctx.parent
        damage.baseDamage += 7
      } else {
        const turn: TurnContext = ctx.parent
        expect(turn.battle).toBe(battle)
      }
      events.push(`apply:${ctx.parent.type}`)
    },
  }
  const effect = defineNativeEffect(definition)
  source.effects.push(effect)
  definition.apply = () => {
    throw new Error('mutated factory input')
  }
  const turn = new TurnContext(battle)
  battle.applyEffects(turn, EffectTrigger.TurnStart, source)
  const parent = new EffectContext(turn, EffectTrigger.TurnStart, source)
  const damage = new DamageContext(parent, source, b.activePet, 10)
  battle.applyEffects(damage, EffectTrigger.OnDamage, source)
  expect(damage.baseDamage).toBe(17)
  damage.baseDamage = 0
  battle.applyEffects(damage, EffectTrigger.OnDamage, source)
  expect(events).toEqual(['when:turn', 'apply:turn', 'when:damage', 'apply:damage', 'when:damage'])
  expect(Object.isFrozen(effect)).toBe(true)
  expect(Object.isFrozen(effect.triggers)).toBe(true)
  expect(Object.isFrozen(effect.tags)).toBe(true)
})

it('restricts native trigger declarations to actual V4 dispatch sites', () => {
  const found = new Set<string>()
  const scan = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory() && entry.name !== 'legacy') scan(path)
      else if (entry.isFile() && entry.name.endsWith('.ts')) {
        for (const match of readFileSync(path, 'utf8').matchAll(/\.applyEffects\([^,\n]+,\s*EffectTrigger\.(\w+)/g)) {
          const key = match[1] as keyof typeof EffectTrigger
          found.add(EffectTrigger[key])
        }
      }
    }
  }
  scan(join(import.meta.dirname, '../../src/v4'))
  expect([...nativeEffectTriggers].sort()).toEqual([...found].sort())
  expect(() => defineNativeEffect({ id: 'empty' as effectId, triggers: [], apply() {} })).toThrow('triggers')
  expect(() =>
    defineNativeEffect({
      id: 'duplicate' as effectId,
      triggers: [EffectTrigger.TurnStart, EffectTrigger.TurnStart],
      apply() {},
    }),
  ).toThrow('Duplicate')
  expect(() =>
    // @ts-expect-error AfterAttacked has no V4 dispatch.
    defineNativeEffect({ id: 'unsupported' as effectId, triggers: [EffectTrigger.AfterAttacked], apply() {} }),
  ).toThrow('Unsupported')
})

// Compile-time checks: the public interface must reject access to the wrong parent.
function typeContract(ctx: NativeEffectContext<EffectTrigger.TurnStart | EffectTrigger.OnDamage>) {
  if (ctx.trigger === EffectTrigger.TurnStart) {
    // @ts-expect-error TurnContext has no baseDamage.
    void ctx.parent.baseDamage
  } else {
    // @ts-expect-error DamageContext has no contextQueue.
    void ctx.parent.contextQueue
  }
}
void typeContract

// Context inference must also work without annotating author callbacks.
function inferredContract() {
  return defineNativeEffect({
    id: 'native/inferred' as effectId,
    triggers: [EffectTrigger.TurnStart, EffectTrigger.OnDamage],
    apply(ctx) {
      if (ctx.trigger === EffectTrigger.OnDamage) {
        const damage: DamageContext = ctx.parent
        void damage
        // @ts-expect-error DamageContext is not a TurnContext.
        const turn: TurnContext = ctx.parent
        void turn
      }
    },
  })
}
void inferredContract
