import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { Type } from '@sinclair/typebox'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  BattleMessageType,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  RemoveMarkContext,
  defineNativeEffect,
  defineParameter,
  ParameterCatalog,
  parameterAddress,
  ConfigModifierType,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createTaggedParameterModifiers } from '@arcadia-eternity/data-pack-base/native'

const candidates = createTaggedParameterModifiers()
const definitions = ['ability', 'emblem'].flatMap(k =>
  parse(readFileSync(new URL(`./fixtures/effect-regression/effect_${k}.yaml`, import.meta.url), 'utf8'), {
    merge: true,
  }),
)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'normal',
  'repeat',
  'no-tags',
  'late-registration',
  'late-tag',
  'cancel',
  'suppress-after',
  'destroy',
  'late-owner',
] as const
function run(id: keyof typeof candidates, native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(751)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const d = definitions.find((d: { id: string }) => d.id === id),
    tag = d.apply.tag
  const sourceMark = new BaseMark('fixture/tag-source' as baseMarkId, [], debuff.config).createInstance()
  sourceMark.setOwner(a.activePet, battle.emitter)
  a.activePet.marks.push(sourceMark)
  const source = kind === 'mark' ? sourceMark : a.activePet.skills[0]
  source.effects.push(native ? candidates[id] : EffectParser.parse(d))
  const defs = [40, 60, 7].map((value, i) =>
    defineParameter({
      address: parameterAddress('fixture/tagged', `use${i}`, 'amount'),
      schema: Type.Number(),
      effectiveSchema: Type.Number(),
      value,
      operations: [ConfigModifierType.delta, ConfigModifierType.override],
      tags: i === 2 || ['no-tags', 'late-tag'].includes(variant) ? [] : [tag],
      aliases: [`old.value${i}`],
    }),
  )
  const catalog = new ParameterCatalog(defs),
    config = battle.configSystem
  if (variant !== 'late-registration') catalog.install(config)
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/tag-before' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id,
      apply: ctx => {
        if (ctx.parent instanceof EffectContext && variant === 'cancel') ctx.parent.available = false
        if (variant === 'late-tag') for (const def of defs.slice(0, 2)) config.addConfigTags(def.address, [tag])
        if (variant === 'late-owner') source.owner = a.team[1]
      },
    }),
  )
  battle.applyEffects(battle, EffectTrigger.OnBattleStart, source)
  if (variant === 'late-registration') catalog.install(config)
  if (variant === 'repeat') battle.applyEffects(battle, EffectTrigger.OnBattleStart, source)
  const read = () =>
    [a.activePet, a.activePet.skills[0], a.team[1], b, b.activePet].map(scope =>
      defs.map(def => catalog.read(config, def.address, scope)),
    )
  const before = read()
  if (variant === 'suppress-after') sourceMark.isSuppressed = true
  if (variant === 'destroy')
    battle.removeMark(
      new RemoveMarkContext(new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, source), sourceMark),
    )
  const after = read()
  sourceMark.isSuppressed = false
  const recovered = read()
  const modifiers = [...config.exportSnapshotState().scopedModifiers.values()]
    .flatMap(entries => [...entries.values()])
    .flat().length
  return {
    before,
    after,
    recovered,
    modifiers,
    alias: catalog.read(config, 'old.value0', a.activePet),
    next: battle.random(),
  }
}
for (const id of Object.keys(candidates) as (keyof typeof candidates)[])
  for (const kind of ['skill', 'mark'] as const)
    for (const variant of variants)
      it(`${id} ${kind} ${variant}`, () => {
        const actual = run(id, true, kind, variant)
        expect(actual).toEqual(run(id, false, kind, variant))
        const opposing = id === 'effect_emblem_add_mark_mabi_chance_5'
        const installed = !['no-tags', 'late-registration', 'cancel'].includes(variant)
        const amount = id === 'effect_ability_increase_huohuanzhixin_gain_1' ? 1 : 5
        const delta = installed && !opposing ? amount * (variant === 'repeat' ? 2 : 1) : 0
        const original = [40, 60, 7],
          modified = [40 + delta, 60 + delta, 7]
        expect(actual.before[variant === 'late-owner' ? 2 : 0]).toEqual(modified)
        expect(actual.before[4]).toEqual(original)
        expect(actual.before[3]).toEqual(original)
        expect(actual.modifiers).toBe(
          installed && !(variant === 'destroy' && kind === 'mark') ? 2 * (variant === 'repeat' ? 2 : 1) : 0,
        )
        if ((variant === 'suppress-after' || variant === 'destroy') && kind === 'mark')
          expect(actual.after[0]).toEqual(original)
        if (variant === 'suppress-after') expect(actual.recovered).toEqual(actual.before)
      })

it('restores tagged modifiers with a fresh catalog and keeps source cleanup working', async () => {
  function freshCatalog(
    f = makeScenario(752),
    effect = createTaggedParameterModifiers().effect_emblem_increase_skill_trigger_rate_5_percent,
  ) {
    if (!battles.includes(f.battle)) battles.push(f.battle)
    const catalog = new SnapshotCatalog('tagged-parameters/1')
    for (const pet of [...f.a.team, ...f.b.team])
      for (const skill of pet.skills)
        for (const item of [...skill.base.effects, ...skill.effects]) catalog.registerEffect(item.id, item)
    for (const effect of f.debuff.effects) catalog.registerEffect(effect.id, effect)
    catalog.registerEffect(effect.id, effect)
    return catalog
  }
  const fixture = makeScenario(753)
  const { battle, a, b, debuff } = fixture
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const source = new BaseMark(
    'fixture/saved-tag-source' as baseMarkId,
    [createTaggedParameterModifiers().effect_emblem_increase_skill_trigger_rate_5_percent],
    { ...debuff.config, persistent: true, keepOnSwitchOut: true },
  ).createInstance()
  source.setOwner(a.activePet, battle.emitter)
  a.activePet.marks.push(source)
  const parameter = () =>
    defineParameter({
      address: parameterAddress('saved', 'first', 'chance'),
      schema: Type.Number(),
      effectiveSchema: Type.Number(),
      value: 40,
      operations: [ConfigModifierType.delta],
      aliases: ['saved.chance'],
      tags: ['skill_effect_probability'],
    })
  const params = new ParameterCatalog([parameter()])
  params.install(battle.configSystem)
  const ready = new Promise<void>(resolve =>
    battle.registerListener(message => {
      if (message.type === BattleMessageType.TurnAction) resolve()
    }),
  )
  const running = battle.startBattle().catch(() => {})
  await ready
  expect(params.read(battle.configSystem, 'saved.chance', a.activePet.skills[0])).toBe(45)
  const saved = JSON.parse(JSON.stringify(snapshotBattle(battle, freshCatalog(fixture, source.effects[0]))))
  await battle.cleanup()
  await running
  const restored = restoreBattle(saved, freshCatalog())
  battles.push(restored)
  const freshParams = new ParameterCatalog([parameter()]),
    pet = restored.playerA.activePet
  expect(freshParams.read(restored.configSystem, 'saved.chance', pet.skills[0])).toBe(45)
  const mark = pet.marks.find(mark => mark.baseId === 'fixture/saved-tag-source')!
  restored.removeMark(
    new RemoveMarkContext(new EffectContext(new TurnContext(restored), EffectTrigger.TurnEnd, pet.skills[0]), mark),
  )
  expect(freshParams.read(restored.configSystem, 'saved.chance', pet.skills[0])).toBe(40)
})

it('samples amount then priority per target and appends one modifier per matched key', () => {
  const { battle, a, b } = makeScenario(754)
  battles.push(battle)
  battle.configSystem.registerTaggedConfig('fixture/read-order', 10, ['fixture/tag'])
  const { selectFrom, ops, compileEffect, defineEffect } = effectAuthoring
  const reads: string[] = []
  let amount = 0
  const value = selectFrom([0])
    .select(() => {
      reads.push('amount')
      return ++amount
    })
    .first()
  const rank = selectFrom([0])
    .select(() => {
      reads.push('priority')
      return amount * 10
    })
    .first()
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/tag-read-order',
      on: 'TurnEnd',
      execute: selectFrom([a.activePet, b.activePet]).apply(
        ops.addTaggedParameterModifier('fixture/tag', 'delta', value, rank),
      ),
    }),
  )
  const context = new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, a.activePet.skills[0], effect)
  battle.executionBudget.run(0, () => effect.innerApply(context))
  expect(reads).toEqual(['amount', 'priority', 'amount', 'priority'])
  const scoped = battle.configSystem.exportSnapshotState().scopedModifiers
  expect(
    [a.activePet, b.activePet].map(p =>
      scoped
        .get(p)!
        .get('fixture/read-order')!
        .map(m => [m.value.value, m.priority]),
    ),
  ).toEqual([[[1, 10]], [[2, 20]]])
})

it('rejects foreign scope before reading a modifier amount', () => {
  const own = makeScenario(755),
    foreign = makeScenario(756)
  battles.push(own.battle, foreign.battle)
  own.battle.configSystem.registerTaggedConfig('fixture/key', 10, ['fixture/tag'])
  const { selectFrom, ops, compileEffect, defineEffect } = effectAuthoring
  let reads = 0
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/tag-foreign',
      on: 'TurnEnd',
      execute: selectFrom([foreign.a.activePet]).apply(
        ops.addTaggedParameterModifier(
          'fixture/tag',
          'delta',
          selectFrom([1])
            .select(v => {
              reads++
              return v
            })
            .first(),
        ),
      ),
    }),
  )
  const context = new EffectContext(
    new TurnContext(own.battle),
    EffectTrigger.TurnEnd,
    own.a.activePet.skills[0],
    effect,
  )
  expect(() => own.battle.executionBudget.run(0, () => effect.innerApply(context))).toThrow('Cross-battle')
  expect(reads).toBe(0)
  expect(own.battle.configSystem.exportSnapshotState().scopedModifiers.size).toBe(0)
})
