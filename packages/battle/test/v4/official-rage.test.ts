import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  officialRageCandidate,
  defineNativeEffect,
  EffectTrigger,
  EffectContext,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  BattleMessageType,
  BaseMark,
  AddMarkContext,
  ConfigModifier,
  ConfigModifierType,
  ConfigDurationType,
  setGlobalLogger,
  type Battle,
  type effectId,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const id = 'effect_skill_add_rage_20_if_rage_below_40'
const alias = `${id}.add_rage_value`
const definitions = parse(
  readFileSync(new URL('../../../../packs/base/data/effect_skill.yaml', import.meta.url), 'utf8'),
  { merge: true },
)
const definition = definitions.find((entry: { id: string }) => entry.id === id)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'normal',
  'at-threshold',
  'below-threshold',
  'wrong-pet',
  'wrong-skill',
  'cancel-effect',
  'cancel-gain',
  'gain-modifier',
  'late-rage',
  'late-owner',
  'late-config',
  'scoped-config',
  'zero',
  'negative',
  'fractional',
  'over-cap',
  'fainted',
] as const
type Variant = (typeof variants)[number]
function run(native: boolean, sourceKind: 'skill' | 'mark', variant: Variant) {
  // Parse before creating Battle so the oracle's registered literal is inherited correctly.
  const effect = native ? officialRageCandidate.effect : EffectParser.parse(definition)
  const f = makeScenario(231)
  const { battle, a, b } = f
  battles.push(battle)
  if (native) officialRageCandidate.parameters.install(battle.configSystem)
  const skill = a.activePet.skills[0]
  const parent = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill)
  const source =
    sourceKind === 'skill'
      ? skill
      : (() => {
          const mark = new BaseMark('fixture/rage' as baseMarkId, [], f.debuff.config)
          battle.addMark(new AddMarkContext(parent, a.activePet, mark))
          return a.activePet.marks.find(candidate => candidate.base === mark)!
        })()
  source.effects.push(effect)
  const modify = (amount: number) => {
    const modifier = new ConfigModifier(
      ConfigDurationType.binding,
      'rage-amount',
      amount,
      ConfigModifierType.override,
      0,
    )
    return native
      ? officialRageCandidate.parameters.modify(battle.configSystem, alias, modifier, source)
      : battle.configSystem.addScopedConfigModifier(alias, modifier, source)
  }
  const amounts: Partial<Record<Variant, number>> = {
    'scoped-config': 35,
    zero: 0,
    negative: -5,
    fractional: 20.75,
    'over-cap': 1000,
  }
  if (amounts[variant] !== undefined) modify(amounts[variant]!)
  a.currentRage = variant === 'at-threshold' ? 40 : variant === 'below-threshold' ? 39 : 10
  b.currentRage = 10
  if (variant === 'fainted') a.activePet.currentHp = 0
  const events: unknown[] = []
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/rage-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.BeforeRageGain],
      when: context =>
        context.trigger === EffectTrigger.BeforeRageGain ||
        (context.parent instanceof EffectContext && context.parent.effect?.id === id),
      apply(context) {
        if (context.trigger === EffectTrigger.BeforeEffect && context.parent instanceof EffectContext) {
          if (variant === 'cancel-effect') context.parent.available = false
          if (variant === 'late-rage') a.currentRage = 95
          if (variant === 'late-owner') source.owner = b.activePet
          if (variant === 'late-config') modify(35)
        }
        if (context.trigger === EffectTrigger.BeforeRageGain) {
          events.push({ hook: 'gain', amount: context.parent.value, target: context.parent.target.id })
          if (variant === 'cancel-gain') context.parent.available = false
          if (variant === 'gain-modifier') context.parent.addModified(50, 2)
        }
      },
    }),
  )
  battle.registerListener(message => {
    if (message.type === BattleMessageType.RageChange) events.push({ type: message.type, data: message.data })
  })
  const use = new UseSkillContext(
    new TurnContext(battle),
    a,
    variant === 'wrong-pet' ? b.activePet : a.activePet,
    AttackTargetOpinion.opponent,
    variant === 'wrong-skill' ? b.activePet.skills[0] : skill,
  )
  battle.applyEffects(use, EffectTrigger.OnHit, source)
  return { rage: [a.currentRage, b.currentRage], events, nextRandom: battle.random() }
}
for (const sourceKind of ['skill', 'mark'] as const) {
  it.each(variants)(`parameterized rage ${sourceKind} matches current YAML for %s`, variant => {
    const actual = run(true, sourceKind, variant)
    expect(actual).toEqual(run(false, sourceKind, variant))
    if (variant === 'normal') {
      expect(actual.rage).toEqual([30, 10])
      expect(actual.events).toContainEqual({ hook: 'gain', amount: 20, target: 'A' })
    }
    if (variant === 'at-threshold') expect(actual.rage).toEqual([40, 10])
    if (variant === 'late-config' || variant === 'scoped-config') expect(actual.rage).toEqual([45, 10])
    if (variant === 'negative') expect(actual.rage).toEqual([5, 10])
  })
}

it('records a stable canonical parameter address and an explicit legacy alias', () => {
  expect(officialRageCandidate.value.address).toBe(`ae:param:["${id}","add-rage","value"]`)
  expect(officialRageCandidate.value.aliases).toEqual([alias])
  expect(officialRageCandidate.value.tags).toEqual([])
})

it('pins the current YAML and source node mapping for this parameterized candidate', () => {
  const record = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/validation/official-rage-candidate.json', import.meta.url), 'utf8'),
  )
  function normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalize)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, normalize(item)]),
      )
    return value
  }
  expect(record.id).toBe(id)
  expect(record.definitionSha256).toBe(
    createHash('sha256')
      .update(JSON.stringify(normalize(definition)))
      .digest('hex'),
  )
  expect(record.parameter.sourcePath).toBe('/apply/value')
  expect(record.parameter.alias).toBe(alias)
  expect(record.parameter.address).toBe(officialRageCandidate.value.address)
})

it('preserves scoped configured rage through a JSON checkpoint in both implementations', async () => {
  async function checkpoint(native: boolean) {
    const effect = native ? officialRageCandidate.effect : EffectParser.parse(definition)
    const f = makeScenario(232)
    battles.push(f.battle)
    if (native) officialRageCandidate.parameters.install(f.battle.configSystem)
    const source = f.a.activePet.skills[0]
    source.effects.push(effect)
    const modifier = new ConfigModifier(ConfigDurationType.binding, 'saved-amount', 35, ConfigModifierType.override, 0)
    if (native) officialRageCandidate.parameters.modify(f.battle.configSystem, alias, modifier, source)
    else f.battle.configSystem.addScopedConfigModifier(alias, modifier, source)
    const catalog = new SnapshotCatalog(`official-rage/${native ? 'native' : 'oracle'}`)
    for (const pet of [...f.a.team, ...f.b.team])
      for (const skill of pet.skills)
        for (const candidate of [...skill.effects, ...skill.base.effects])
          catalog.registerEffect(candidate.id, candidate)
    for (const candidate of f.debuff.effects) catalog.registerEffect(candidate.id, candidate)
    const ready = new Promise<void>(resolve =>
      f.battle.registerListener(message => {
        if (message.type === BattleMessageType.TurnAction) resolve()
      }),
    )
    const run = f.battle.startBattle().catch(error => expect(error.message).toBe('Battle cancelled'))
    await ready
    f.a.currentRage = 10
    const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalog)))
    await f.battle.cleanup()
    await run
    const restored = restoreBattle(saved, catalog)
    battles.push(restored)
    const owner = restored.playerA,
      skill = owner.activePet.skills[0]
    const events: unknown[] = []
    restored.registerListener(message => {
      if (message.type === BattleMessageType.RageChange) events.push(message.data)
    })
    const use = new UseSkillContext(
      new TurnContext(restored),
      owner,
      owner.activePet,
      AttackTargetOpinion.opponent,
      skill,
    )
    restored.applyEffects(use, EffectTrigger.OnHit, skill)
    const effective = native
      ? officialRageCandidate.parameters.read(restored.configSystem, alias, skill)
      : restored.configSystem.get(alias, skill)
    return { rage: owner.currentRage, effective, events, nextRandom: restored.random() }
  }
  const actual = await checkpoint(true)
  expect(actual).toEqual(await checkpoint(false))
  expect(actual.rage).toBe(45)
  expect(actual.effective).toBe(35)
})

it('isolates the new parameter by battle and source, with reversible alias-based changes', () => {
  const first = makeScenario(233),
    second = makeScenario(234)
  battles.push(first.battle, second.battle)
  for (const f of [first, second]) officialRageCandidate.parameters.install(f.battle.configSystem)
  const source = first.a.activePet.skills[0]
  const remove = officialRageCandidate.parameters.modify(
    first.battle.configSystem,
    alias,
    new ConfigModifier(ConfigDurationType.binding, 'only-first-source', 7, ConfigModifierType.delta, 0),
    source,
  )
  expect(officialRageCandidate.parameters.read(first.battle.configSystem, alias, source)).toBe(27)
  expect(officialRageCandidate.parameters.read(first.battle.configSystem, alias, first.b.activePet.skills[0])).toBe(20)
  expect(officialRageCandidate.parameters.read(second.battle.configSystem, alias, second.a.activePet.skills[0])).toBe(
    20,
  )
  remove()
  expect(officialRageCandidate.parameters.read(first.battle.configSystem, alias, source)).toBe(20)
})
