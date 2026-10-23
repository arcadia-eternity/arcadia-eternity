import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  defineNativeEffect,
  BaseMark,
  BaseSkill,
  SkillInstance,
  Category,
  AddMarkContext,
  EffectTrigger,
  EffectContext,
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
import { officialConsecutiveHealingEffects } from '@arcadia-eternity/data-pack-base/native'

const definitions = parse(
  readFileSync(new URL('./fixtures/effect-regression/effect_skill.yaml', import.meta.url), 'utf8'),
  { merge: true },
)
type Id = keyof typeof officialConsecutiveHealingEffects
const ids = Object.keys(officialConsecutiveHealingEffects) as Id[]
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function candidate(id: Id, native: boolean) {
  return native
    ? officialConsecutiveHealingEffects[id]
    : EffectParser.parse(definitions.find((d: { id: string }) => d.id === id))
}
const variants = [
  'first',
  'second',
  'third',
  'late-first',
  'late-second',
  'late-owner',
  'late-max-hp',
  'heal-hook-change',
  'modify',
  'cancel-effect',
  'cancel-heal',
  'wrong-skill',
  'full',
  'fainted',
] as const
function run(id: Id, native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(263)
  battles.push(battle)
  const owner = a.activePet,
    skill = owner.skills[0]
  for (const pet of [...a.team, ...b.team]) {
    pet.attributeSystem.updateBaseValue('maxHp', 407)
    pet.currentHp = 11
    pet.lastSkillUsedTimes = 1
  }
  owner.currentHp = variant === 'full' ? 407 : variant === 'fainted' ? 0 : 11
  owner.lastSkillUsedTimes = variant === 'third' ? 3 : ['second', 'late-first'].includes(variant) ? 2 : 1
  b.activePet.lastSkillUsedTimes = 2
  let source: typeof skill | (typeof owner.marks)[number] = skill
  if (kind === 'mark') {
    const base = new BaseMark('fixture/consecutive-source' as baseMarkId, [], debuff.config)
    battle.addMark(
      new AddMarkContext(new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill), owner, base),
    )
    source = owner.marks.find(mark => mark.base === base)!
  }
  const effect = candidate(id, native)
  if (native) effectAuthoring.effectParameters(effect).install(battle.configSystem)
  source.effects.push(effect)
  const amounts: number[] = [],
    events: unknown[] = []
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/consecutive-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnBeforeHeal],
      when: context =>
        context.trigger !== EffectTrigger.BeforeEffect ||
        (context.parent instanceof EffectContext && context.parent.effect?.id === id),
      apply(context) {
        if (context.trigger === EffectTrigger.BeforeEffect && context.parent instanceof EffectContext) {
          if (variant === 'late-first') owner.lastSkillUsedTimes = 1
          if (variant === 'late-second') owner.lastSkillUsedTimes = 2
          if (variant === 'late-owner') source.owner = b.activePet
          if (variant === 'late-max-hp') owner.attributeSystem.updateBaseValue('maxHp', 419)
          if (variant === 'cancel-effect') context.parent.available = false
        }
        if (context.trigger === EffectTrigger.OnBeforeHeal) {
          amounts.push(context.parent.value)
          if (variant === 'heal-hook-change') {
            owner.lastSkillUsedTimes = 2
            owner.attributeSystem.updateBaseValue('maxHp', 419)
          }
          if (variant === 'modify') context.parent.addModified(0, 7)
          if (variant === 'cancel-heal') context.parent.available = false
        }
      },
    }),
  )
  battle.registerListener(message => {
    if ([BattleMessageType.Heal, BattleMessageType.HealFail].includes(message.type))
      events.push({ type: message.type, data: message.data })
  })
  battle.applyEffects(
    new UseSkillContext(
      new TurnContext(battle),
      a,
      owner,
      AttackTargetOpinion.opponent,
      variant === 'wrong-skill' ? b.activePet.skills[0] : skill,
    ),
    EffectTrigger.OnHit,
    source,
  )
  return { hp: [...a.team, ...b.team].map(pet => pet.currentHp), amounts, events, nextRandom: battle.random() }
}
const expectedAmounts: Record<Id, [number, number]> = {
  effect_skill_heal_self_120_hp_if_consecutive_half: [60, 120],
  effect_skill_heal_self_125_hp_if_consecutive_half: [63, 125],
  effect_skill_heal_self_quarter_if_consecutive_half: [101, 50],
}
for (const id of ids)
  for (const kind of ['skill', 'mark'] as const) {
    it.each(variants)(`${id} ${kind} preserves current YAML for %s`, variant => {
      const actual = run(id, true, kind, variant)
      expect(actual).toEqual(run(id, false, kind, variant))
      if (['first', 'second', 'third', 'late-first', 'late-second', 'heal-hook-change'].includes(variant)) {
        const second = ['second', 'third', 'late-second'].includes(variant)
        const amount = expectedAmounts[id][second ? 1 : 0]
        expect(actual.amounts).toEqual([amount])
        expect(actual.hp[0]).toBe(11 + amount)
      }
      if (variant === 'late-owner') expect(actual.hp[2]).toBe(11 + expectedAmounts[id][1])
    })
  }

async function skillSequence(id: Id, native: boolean, checkpoint: boolean) {
  const f = makeScenario(264)
  let battle = f.battle
  battles.push(battle)
  let owner = f.a.activePet,
    skill = owner.skills[0]
  const effect = candidate(id, native)
  if (native) effectAuthoring.effectParameters(effect).install(battle.configSystem)
  skill.effects.splice(0, skill.effects.length, effect)
  const catalog = () => {
    const result = new SnapshotCatalog('consecutive-healing/1')
    for (const pet of [...f.a.team, ...f.b.team])
      for (const source of pet.skills)
        for (const effect of [...source.base.effects, ...source.effects]) result.registerEffect(effect.id, effect)
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
  owner.attributeSystem.updateBaseValue('maxHp', 407)
  const values: { times: number; healed: number }[] = []
  const attack = (chosen: SkillInstance) => {
    owner.currentHp = 11
    owner.owner!.currentRage = 100
    owner.owner!.performAttack(
      new UseSkillContext(new TurnContext(battle), owner.owner!, owner, AttackTargetOpinion.opponent, chosen),
    )
    values.push({ times: owner.lastSkillUsedTimes, healed: owner.currentHp - 11 })
    expect(battle.phaseManager.getPhasesByState(PhaseState.Failed)).toEqual([])
  }
  attack(skill)
  if (checkpoint) {
    const data = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog())))
    await battle.cleanup()
    await running
    battle = restoreBattle(data, catalog())
    battles.push(battle)
    owner = battle.playerA.activePet
    skill = owner.skills[0]
    expect(owner.lastSkill).toBe(skill)
    expect(owner.lastSkillUsedTimes).toBe(1)
  }
  attack(skill)
  attack(skill)
  const other = new SkillInstance(
    new BaseSkill.Builder().withID('fixture/other').withSkillType(Category.Status).setSureHit().build(),
  )
  other.setOwner(owner)
  attack(other)
  attack(skill)
  const result = { values, nextRandom: battle.random() }
  await battle.cleanup()
  await running
  return result
}
for (const id of ids)
  it(`${id} follows actual repeated skill use, reset, and JSON restoration`, async () => {
    const expected = await skillSequence(id, false, false)
    const [first, second] = expectedAmounts[id]
    expect(expected.values).toEqual([
      { times: 1, healed: first },
      { times: 2, healed: second },
      { times: 3, healed: second },
      { times: 1, healed: 0 },
      { times: 1, healed: first },
    ])
    expect(await skillSequence(id, true, false)).toEqual(expected)
    expect(await skillSequence(id, false, true)).toEqual(expected)
    expect(await skillSequence(id, true, true)).toEqual(expected)
  })

it('pins every consecutive healing candidate to its current YAML source', () => {
  const ledger = JSON.parse(
    readFileSync(
      new URL('../../../../docs/v4/validation/consecutive-healing-candidates.json', import.meta.url),
      'utf8',
    ),
  )
  expect(ledger.records.map((record: { id: string }) => record.id).sort()).toEqual([...ids].sort())
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
  for (const record of ledger.records)
    expect(
      createHash('sha256')
        .update(JSON.stringify(normalize(definitions.find((item: { id: string }) => item.id === record.id))))
        .digest('hex'),
    ).toBe(record.definitionSha256)
})
