import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  parameterAddress,
  BaseMark,
  AddMarkContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  SwitchPetPhase,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createWeaknessTransfer } from '@arcadia-eternity/data-pack-base/native'

const id = 'effect_emblem_set_ruodianbiaoji_keeponswitchout'
const original = parse(
  readFileSync(new URL('../../../../packs/base/data/effect_emblem.yaml', import.meta.url), 'utf8'),
  { merge: true },
).find((d: { id: string }) => d.id === id)
function repaired() {
  const d = structuredClone(original)
  d.condition.conditions[1].target.chain[0].arg = 'baseMark.id'
  return d
}
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'normal',
  'wrong-applicant',
  'wrong-base',
  'cancel',
  'nested',
  'late-base',
  'suppressed',
  'repeat',
  'real-switch',
  'real-keep',
] as const
function run(
  native: boolean,
  kind: 'mark' | 'skill',
  recipient: 'self' | 'opponent',
  variant: (typeof variants)[number],
  transfer?: boolean,
) {
  const { battle, a, b, debuff } = makeScenario(841)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const sourceMark = new BaseMark('fixture/weakness-source' as baseMarkId, [], {
    ...debuff.config,
    persistent: true,
    duration: -1,
    keepOnSwitchOut: true,
  }).createInstance()
  sourceMark.setOwner(a.activePet, battle.emitter)
  a.activePet.marks.push(sourceMark)
  sourceMark.isSuppressed = variant === 'suppressed'
  const source = kind === 'mark' ? sourceMark : a.activePet.skills[0]
  const effect = native ? createWeaknessTransfer() : EffectParser.parse(repaired())
  if (native) effectAuthoring.effectParameters(effect).install(battle.configSystem)
  if (transfer !== undefined) battle.configSystem.set(parameterAddress(id, 'parameters', 'transfer'), transfer)
  source.effects.push(effect)
  const base = new BaseMark((variant === 'wrong-base' ? 'fixture/other-mark' : 'mark_ruodianjihao') as baseMarkId, [], {
    ...debuff.config,
    persistent: true,
    duration: -1,
    maxStacks: 10,
    keepOnSwitchOut: variant === 'real-keep',
    transferOnSwitch: false,
  })
  const applicant = variant === 'wrong-applicant' ? b.activePet.skills[0] : a.activePet.skills[0]
  const parent = new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, applicant)
  const player = recipient === 'self' ? a : b,
    target = player.activePet,
    incoming = player.team[1]
  const event = new AddMarkContext(parent, target, base, 2)
  const trace: unknown[] = []
  let applications = 0
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/weakness-observer' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.AfterEffect],
      when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id,
      apply: ctx => {
        trace.push([ctx.trigger, event.config?.transferOnSwitch ?? null, event.baseMark.id])
        if (ctx.trigger === EffectTrigger.BeforeEffect && ctx.parent instanceof EffectContext) {
          applications++
          if (variant === 'cancel') ctx.parent.available = false
          if (variant === 'late-base') event.baseMark = new BaseMark('fixture/late-base' as baseMarkId, [], base.config)
        }
      },
    }),
  )
  if (variant.startsWith('real-')) {
    battle.addMark(event)
    const phase = new SwitchPetPhase(battle, player, incoming, new TurnContext(battle))
    battle.phaseManager.registerPhase(phase)
    battle.phaseManager.executePhase(phase.id)
  } else {
    const context = variant === 'nested' ? new EffectContext(event, EffectTrigger.OnBeforeAddMark, source) : event
    battle.applyEffects(context, EffectTrigger.OnBeforeAddMark as EffectTrigger, source)
    if (variant === 'repeat') battle.applyEffects(context, EffectTrigger.OnBeforeAddMark as EffectTrigger, source)
  }
  const marks = (pet: typeof target) =>
    pet.marks
      .filter(mark => mark.baseId === 'mark_ruodianjihao')
      .map(mark => ({
        stack: mark.stack,
        transfer: mark.config.transferOnSwitch,
        keep: mark.config.keepOnSwitchOut,
        owned: mark.owner === pet,
      }))
  return {
    applications,
    config: event.config,
    trace,
    outgoing: marks(target),
    incoming: marks(incoming),
    activeIncoming: player.activePet === incoming,
    next: battle.random(),
  }
}
for (const kind of ['mark', 'skill'] as const)
  for (const recipient of ['self', 'opponent'] as const)
    for (const variant of variants)
      it(`${kind} ${recipient} ${variant}`, () => {
        const actual = run(true, kind, recipient, variant)
        expect(actual).toEqual(run(false, kind, recipient, variant))
        const admitted =
          !['wrong-applicant', 'wrong-base', 'nested'].includes(variant) &&
          !(kind === 'mark' && variant === 'suppressed')
        expect(actual.applications).toBe(admitted ? (variant === 'repeat' ? 2 : 1) : 0)
        if (admitted && variant !== 'cancel') expect(actual.config?.transferOnSwitch).toBe(true)
        if (variant.startsWith('real-')) {
          expect(actual.activeIncoming).toBe(true)
          expect(actual.outgoing).toEqual([])
          expect(actual.incoming).toEqual([{ stack: 2, transfer: true, keep: variant === 'real-keep', owned: true }])
        }
      })
it('requires the explicit baseMarkId-to-baseMark.id path repair', () => {
  expect(() => EffectParser.parse(original)).toThrow()
  expect(() => EffectParser.parse(repaired())).not.toThrow()
})
it('allows UGC to disable transfer independently from keeping the outgoing mark', () => {
  const result = run(true, 'mark', 'self', 'real-keep', false)
  expect(result.outgoing).toEqual([{ stack: 2, transfer: false, keep: true, owned: true }])
  expect(result.incoming).toEqual([])
})

for (const value of [true, false, undefined])
  it(`reads one transfer flag for all application contexts: ${value}`, () => {
    const { battle, a, b, debuff } = makeScenario(842)
    battles.push(battle)
    const { selectFrom, ops, compileEffect, defineEffect } = effectAuthoring
    const parent = new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, a.activePet.skills[0])
    const first = new AddMarkContext(parent, a.activePet, debuff),
      second = new AddMarkContext(parent, b.activePet, debuff)
    first.setTransferOnSwitch(true)
    let reads = 0
    const input = selectFrom([0])
      .flatMap(() => {
        reads++
        return value === undefined ? [] : [value]
      })
      .first()
    const effect = compileEffect(
      defineEffect({
        id: 'fixture/transfer-flag',
        on: 'TurnEnd',
        execute: selectFrom([first, second]).apply(ops.setMarkTransferOnSwitch(input)),
      }),
    )
    battle.executionBudget.run(0, () => effect.innerApply(parent))
    expect(reads).toBe(1)
    expect([first.config?.transferOnSwitch, second.config?.transferOnSwitch]).toEqual(
      value === undefined ? [true, false] : [value, value],
    )
    expect(debuff.config.transferOnSwitch).toBe(false)
  })
it('rejects a foreign application context before reading or writing', () => {
  const f = makeScenario(843),
    other = makeScenario(844)
  battles.push(f.battle, other.battle)
  const { selectFrom, ops, compileEffect, defineEffect } = effectAuthoring
  const parent = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnEnd, f.a.activePet.skills[0])
  const foreign = new EffectContext(new TurnContext(other.battle), EffectTrigger.TurnEnd, other.a.activePet.skills[0])
  const first = new AddMarkContext(parent, f.a.activePet, f.debuff),
    second = new AddMarkContext(foreign, other.a.activePet, other.debuff)
  let reads = 0
  const input = selectFrom([true])
    .select(value => {
      reads++
      return value
    })
    .first()
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/foreign-transfer',
      on: 'TurnEnd',
      execute: selectFrom([first, second]).apply(ops.setMarkTransferOnSwitch(input)),
    }),
  )
  const before = structuredClone([first.config, second.config])
  expect(() => f.battle.executionBudget.run(0, () => effect.innerApply(parent))).toThrow('Cross-battle')
  expect(reads).toBe(0)
  expect([first.config, second.config]).toEqual(before)
})
