import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  officialDamageBenefitEffects,
  defineNativeEffect,
  BaseMark,
  AddMarkContext,
  DamageContext,
  DamageType,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  BattleMessageType,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  PhaseState,
  setGlobalLogger,
  type Battle,
  type effectId,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const definitions = parse(
  readFileSync(new URL('../../../../packs/base/data/effect_skill.yaml', import.meta.url), 'utf8'),
  { merge: true },
)
type Id = keyof typeof officialDamageBenefitEffects
const ids = Object.keys(officialDamageBenefitEffects) as Id[]
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function candidate(id: Id, native: boolean) {
  return native
    ? officialDamageBenefitEffects[id]
    : EffectParser.parse(definitions.find((d: { id: string }) => d.id === id))
}
const variants = [
  'normal',
  'threshold',
  'below',
  'overkill',
  'shield',
  'partial-shield',
  'ignore-shield',
  'not-crit',
  'late-result',
  'late-threshold',
  'late-owner',
  'wrong-skill',
  'nested',
  'orphan',
  'cancel-damage',
  'cancel-effect',
  'cancel-benefit',
  'modify-benefit',
] as const
function run(id: Id, native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  const f = makeScenario(265),
    { battle, a, b } = f
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.attributeSystem.updateBaseValue('maxHp', 501)
    pet.currentHp = 11
  }
  b.activePet.currentHp = variant === 'overkill' ? 10 : 501
  a.currentRage = b.currentRage = 30
  const owner = a.activePet,
    skill = owner.skills[0]
  skill.effects.splice(0)
  let source: typeof skill | (typeof owner.marks)[number] = skill
  const use = new UseSkillContext(
    new TurnContext(battle),
    a,
    owner,
    AttackTargetOpinion.opponent,
    variant === 'wrong-skill' ? b.activePet.skills[0] : skill,
  )
  const setup = new EffectContext(use, EffectTrigger.OnHit, skill)
  if (kind === 'mark') {
    const mark = new BaseMark('fixture/damage-source' as baseMarkId, [], f.debuff.config)
    battle.addMark(new AddMarkContext(setup, owner, mark))
    source = owner.marks.find(m => m.base === mark)!
  }
  source.effects.push(candidate(id, native))
  if (['shield', 'partial-shield', 'ignore-shield'].includes(variant)) {
    const shield = new BaseMark('fixture/damage-shield' as baseMarkId, [], {
      ...f.debuff.config,
      isShield: true,
      maxStacks: 1000,
    })
    battle.addMark(new AddMarkContext(setup, b.activePet, shield, variant === 'partial-shield' ? 6 : 101))
  }
  const amounts: number[] = [],
    events: unknown[] = []
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/damage-hook' as effectId,
      triggers: [
        EffectTrigger.BeforeEffect,
        EffectTrigger.OnBeforeCalculateDamage,
        EffectTrigger.OnBeforeHeal,
        EffectTrigger.BeforeRageGain,
      ],
      when: context =>
        context.trigger !== EffectTrigger.BeforeEffect ||
        (context.parent instanceof EffectContext && context.parent.effect?.id === id),
      apply(context) {
        if (
          context.trigger === EffectTrigger.BeforeEffect &&
          context.parent instanceof EffectContext &&
          context.parent.parent instanceof DamageContext
        ) {
          if (variant === 'late-result') context.parent.parent.damageResult = 19
          if (variant === 'late-owner') source.owner = b.team[1]
          if (variant === 'cancel-effect') context.parent.available = false
        }
        if (context.trigger === EffectTrigger.OnBeforeCalculateDamage && variant === 'cancel-damage')
          context.parent.available = false
        if (context.trigger === EffectTrigger.OnBeforeHeal || context.trigger === EffectTrigger.BeforeRageGain) {
          amounts.push(context.parent.value)
          if (variant === 'cancel-benefit') context.parent.available = false
          if (variant === 'modify-benefit') context.parent.addModified(0, 7)
        }
      },
    }),
  )
  // A separately ordered effect can alter a collected context but must not retroactively admit an excluded candidate.
  if (variant === 'late-threshold')
    skill.effects.push(
      defineNativeEffect({
        id: 'fixture/late-damage' as effectId,
        triggers: [EffectTrigger.OnDamage],
        priority: 100,
        apply(context) {
          context.parent.damageResult = 150
        },
      }),
    )
  battle.registerListener(message => {
    if (
      [
        BattleMessageType.Heal,
        BattleMessageType.HealFail,
        BattleMessageType.RageChange,
        BattleMessageType.Damage,
        BattleMessageType.DamageFail,
      ].includes(message.type)
    )
      events.push({ type: message.type, data: message.data })
  })
  const parent =
    variant === 'orphan'
      ? new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, skill)
      : variant === 'nested'
        ? setup
        : use
  const damage = new DamageContext(
    parent,
    owner,
    b.activePet,
    ['threshold', 'late-threshold'].includes(variant) ? 100 : variant === 'below' ? 99 : 101,
    DamageType.Effect,
    variant !== 'not-crit',
    1,
    variant === 'ignore-shield',
  )
  b.activePet.damage(damage)
  expect(battle.phaseManager.getPhasesByState(PhaseState.Failed)).toEqual([])
  return {
    hp: [...a.team, ...b.team].map(pet => pet.currentHp),
    rage: [a.currentRage, b.currentRage],
    amounts,
    events,
    damage: damage.damageResult,
    nextRandom: battle.random(),
  }
}
for (const id of ids)
  for (const kind of ['skill', 'mark'] as const)
    it.each(variants)(`${id} ${kind} matches current YAML for %s`, variant => {
      const actual = run(id, true, kind, variant)
      expect(actual).toEqual(run(id, false, kind, variant))
      if (variant === 'normal' || variant === 'overkill' || variant === 'nested' || variant === 'ignore-shield') {
        const healing = id === 'effect_skill_heal_25_percent_damage_dealt'
        expect(actual.amounts).toEqual([id === 'effect_skill_crit_gain_rage_20' ? 20 : 25])
        expect(healing ? actual.hp[0] : actual.rage[0]).toBe(
          healing ? 36 : id === 'effect_skill_crit_gain_rage_20' ? 50 : 55,
        )
      }
      if (variant === 'shield' || variant === 'partial-shield') {
        const result = variant === 'shield' ? 0 : 95
        expect(actual.damage).toBe(result)
        expect(actual.amounts).toEqual(
          id === 'effect_skill_heal_25_percent_damage_dealt'
            ? [Math.floor(result / 4)]
            : id === 'effect_skill_crit_gain_rage_20'
              ? [20]
              : [],
        )
      }
      if (
        ['cancel-damage', 'cancel-effect', 'orphan'].includes(variant) ||
        (variant === 'wrong-skill' && kind === 'skill')
      )
        expect(actual.amounts).toEqual([])
      if (variant === 'wrong-skill' && kind === 'mark')
        expect(actual.amounts).toEqual([id === 'effect_skill_crit_gain_rage_20' ? 20 : 25])
      if (variant === 'not-crit' && id === 'effect_skill_crit_gain_rage_20') expect(actual.amounts).toEqual([])
      if (variant === 'late-result' && id === 'effect_skill_heal_25_percent_damage_dealt')
        expect(actual.amounts).toEqual([4])
      if (variant === 'late-result' && id === 'effect_skill_add_rage_25_if_damage_over_100')
        expect(actual.amounts).toEqual([25])
      if (variant === 'late-threshold' && id === 'effect_skill_add_rage_25_if_damage_over_100')
        expect(actual.amounts).toEqual([])
    })

async function restoredDamage(id: Id, native: boolean, checkpoint: boolean) {
  const f = makeScenario(266)
  let battle = f.battle
  battles.push(battle)
  f.a.activePet.skills[0].effects.splice(0, f.a.activePet.skills[0].effects.length, candidate(id, native))
  const catalog = () => {
    const result = new SnapshotCatalog('damage-benefits/1')
    for (const pet of [...f.a.team, ...f.b.team])
      for (const skill of pet.skills)
        for (const effect of [...skill.base.effects, ...skill.effects]) result.registerEffect(effect.id, effect)
    for (const effect of f.debuff.effects) result.registerEffect(effect.id, effect)
    return result
  }
  const ready = new Promise<void>(resolve =>
    battle.registerListener(message => {
      if (message.type === BattleMessageType.TurnAction) resolve()
    }),
  )
  const running = battle.startBattle().catch(error => {
    if (error.message !== 'Battle cancelled') throw error
  })
  await Promise.race([
    ready,
    running.then(() => {
      throw new Error('Battle ended before selection')
    }),
  ])
  const values: unknown[] = []
  const hit = () => {
    const a = battle.playerA,
      b = battle.playerB,
      skill = a.activePet.skills[0]
    a.activePet.currentHp = 11
    b.activePet.attributeSystem.updateBaseValue('maxHp', 501)
    b.activePet.currentHp = 501
    a.currentRage = 30
    const use = new UseSkillContext(new TurnContext(battle), a, a.activePet, AttackTargetOpinion.opponent, skill)
    b.activePet.damage(new DamageContext(use, a.activePet, b.activePet, 101, DamageType.Effect, true))
    values.push({ hp: a.activePet.currentHp, rage: a.currentRage, targetHp: b.activePet.currentHp })
    expect(battle.phaseManager.getPhasesByState(PhaseState.Failed)).toEqual([])
  }
  hit()
  if (checkpoint) {
    const data = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog())))
    await battle.cleanup()
    await running
    battle = restoreBattle(data, catalog())
    battles.push(battle)
  }
  hit()
  const result = { values, nextRandom: battle.random() }
  await battle.cleanup()
  await running
  return result
}
for (const id of ids)
  it(`${id} survives a selection checkpoint between real damage phases`, async () => {
    const expected = await restoredDamage(id, false, false)
    expect(await restoredDamage(id, true, false)).toEqual(expected)
    expect(await restoredDamage(id, false, true)).toEqual(expected)
    expect(await restoredDamage(id, true, true)).toEqual(expected)
  })
it('pins exact candidate coverage and current source definitions', () => {
  const ledger = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/validation/damage-benefits-candidates.json', import.meta.url), 'utf8'),
  )
  expect(ledger.records.map((record: { id: string }) => record.id).sort()).toEqual([...ids].sort())
  const normalize = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, normalize(item)]),
          )
        : value
  for (const record of ledger.records)
    expect(
      createHash('sha256')
        .update(JSON.stringify(normalize(definitions.find((d: { id: string }) => d.id === record.id))))
        .digest('hex'),
    ).toBe(record.definitionSha256)
})
