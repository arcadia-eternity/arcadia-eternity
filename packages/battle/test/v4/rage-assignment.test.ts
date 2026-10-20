import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, Operators } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedRageAssignment,
  effectAuthoring,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  SwitchPetContext,
  AttackTargetOpinion,
  BattleMessageType,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const definitions = new Map<string, unknown>()
for (const kind of ['ability', 'mark', 'skill'])
  for (const d of parse(
    readFileSync(new URL(`../../../../packs/base/data/effect_${kind}.yaml`, import.meta.url), 'utf8'),
    { merge: true },
  ))
    definitions.set(d.id, d)
const ids = Object.keys(generatedRageAssignment) as (keyof typeof generatedRageAssignment)[]
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
const variants = ['normal', 'threshold', 'bench', 'cancel', 'late-value'] as const
function run(id: (typeof ids)[number], native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  const f = makeScenario(241)
  battles.push(f.battle)
  const { battle, a, b } = f
  for (const p of [...a.team, ...b.team]) {
    p.marks.splice(0)
    for (const s of p.skills) s.effects.splice(0)
  }
  const owner = variant === 'bench' ? a.team[1] : a.activePet
  const skill = owner.skills[0]
  const source =
    kind === 'skill' ? skill : new BaseMark('fixture/rage-source' as baseMarkId, [], f.debuff.config).createInstance()
  if (kind === 'mark') {
    const mark = source as ReturnType<BaseMark['createInstance']>
    mark.setOwner(owner, battle.emitter)
    owner.marks.push(mark)
  }
  source.effects.push(native ? generatedRageAssignment[id] : EffectParser.parse(definitions.get(id)))
  a.settingRage(variant === 'threshold' ? 25 : 17)
  b.settingRage(60)
  const changes: unknown[] = []
  battle.registerListener(m => {
    if (m.type === BattleMessageType.RageChange)
      changes.push({ before: m.data.before, after: m.data.after, reason: m.data.reason, player: m.data.player })
  })
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/rage-setting-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        if (variant === 'cancel' && c.parent instanceof EffectContext) c.parent.available = false
        if (variant === 'late-value') a.settingRage(39)
      },
    }),
  )
  const turn = new TurnContext(battle)
  if (id === 'effect_skill_set_opponent_rage_to_self')
    battle.applyEffects(
      new UseSkillContext(turn, a, owner, AttackTargetOpinion.opponent, skill),
      EffectTrigger.OnHit,
      source,
    )
  else if (id === 'effect_mark_clear_rage_on_switch_out')
    battle.applyEffects(new SwitchPetContext(turn, a, a.team[1]), EffectTrigger.OnSwitchOut, source)
  else
    battle.applyEffects(
      turn,
      id === 'effect_ability_keep_rage_at_least_25' ? EffectTrigger.OnBattleStart : EffectTrigger.TurnStart,
      source,
    )
  return { rage: [a.currentRage, b.currentRage], changes }
}
for (const id of ids)
  for (const kind of ['skill', 'mark'] as const)
    for (const variant of variants)
      it(`${id}/${kind}/${variant} preserves historical assignment and messages`, () => {
        const actual = run(id, true, kind, variant)
        expect(actual).toEqual(run(id, false, kind, variant))
        const copy = id === 'effect_skill_set_opponent_rage_to_self'
        const skipped =
          variant === 'cancel' ||
          (!copy && variant === 'bench') ||
          (id === 'effect_ability_keep_rage_at_least_25' && variant === 'threshold')
        expect(actual.changes).toHaveLength(skipped ? 0 : 1)
        if (!skipped)
          expect(actual.rage[copy ? 1 : 0]).toBe(
            copy
              ? variant === 'late-value'
                ? 39
                : variant === 'threshold'
                  ? 25
                  : 17
              : id === 'effect_ability_keep_rage_at_least_25'
                ? 25
                : 0,
          )
      })
for (const amount of [-10, 0, 12.5, 10000])
  it(`sets ${amount} through the same phase as legacy, including duplicate targets`, () => {
    const runOperation = (native: boolean) => {
      const f = makeScenario(241)
      battles.push(f.battle)
      f.a.settingRage(40)
      const changes: unknown[] = []
      f.battle.registerListener(m => {
        if (m.type === BattleMessageType.RageChange)
          changes.push({ before: m.data.before, after: m.data.after, reason: m.data.reason })
      })
      const ctx = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, f.a.activePet.skills[0])
      const selected = [f.a.activePet, f.a]
      if (native) {
        const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
        const effect = compileEffect(
          defineEffect({
            id: 'fixture/set-rage',
            on: 'TurnStart',
            execute: selectFrom(selected).apply(ops.setRage(amount)),
          }),
        )
        f.battle.executionBudget.run(0, () => effect.innerApply(ctx))
      } else Operators.setRage(amount)(ctx, selected)
      expect(changes).toHaveLength(2)
      expect(f.a.currentRage).toBe(Math.min(f.a.maxRage, Math.max(0, amount)))
      return { rage: f.a.currentRage, changes }
    }
    expect(runOperation(true)).toEqual(runOperation(false))
  })

it('samples the value once before phase callbacks and skips absent input', () => {
  const f = makeScenario(241)
  battles.push(f.battle)
  const { compileEffect, defineEffect, selectFrom, targets, ops } = effectAuthoring
  let reads = 0
  let present = true
  let amount = 17
  let messages = 0
  f.battle.registerListener(m => {
    if (m.type === BattleMessageType.RageChange) {
      messages++
      amount = 39
    }
  })
  const input = targets.ownerPet
    .where(() => {
      reads++
      return present
    })
    .select(() => amount)
    .first()
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/rage-read-once',
      on: 'TurnStart',
      execute: selectFrom([f.a, f.b]).apply(ops.setRage(input)),
    }),
  )
  const ctx = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, f.a.activePet.skills[0])
  const fire = () => f.battle.executionBudget.run(0, () => effect.innerApply(ctx))
  fire()
  expect(reads).toBe(1)
  expect([f.a.currentRage, f.b.currentRage]).toEqual([17, 17])
  expect(messages).toBe(2)
  present = false
  fire()
  expect(reads).toBe(2)
  expect(messages).toBe(2)
  expect([f.a.currentRage, f.b.currentRage]).toEqual([17, 17])
})
