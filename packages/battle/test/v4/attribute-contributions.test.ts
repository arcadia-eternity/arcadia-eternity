import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  BaseMark,
  BaseSkill,
  SkillInstance,
  AddMarkContext,
  RemoveMarkContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  Category,
  Element,
  AttackTargetOpinion,
  defineNativeEffect,
  setGlobalLogger,
  parameterAddress,
  type Battle,
  type baseMarkId,
  type baseSkillId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { generatedAttributeContributions } from '@arcadia-eternity/data-pack-base/native'

type Id = Exclude<keyof typeof generatedAttributeContributions, 'effect_mark_increase_crit_rate_20_percent_per_stack'>
const ids = (Object.keys(generatedAttributeContributions) as (keyof typeof generatedAttributeContributions)[]).filter(
  id => id !== 'effect_mark_increase_crit_rate_20_percent_per_stack',
)
const ledger = JSON.parse(
  readFileSync(
    new URL('../../../../docs/v4/validation/attribute-contributions-candidates.json', import.meta.url),
    'utf8',
  ),
)
function normalize(v: unknown): unknown {
  return Array.isArray(v)
    ? v.map(normalize)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map(k => [k, normalize((v as Record<string, unknown>)[k])]),
        )
      : v
}
const definitions = new Map(
  ids.map(id => {
    const r = ledger.records.find((r: { id: string }) => r.id === id)
    const d = parse(readFileSync(new URL(`../../../../${r.sourceFile}`, import.meta.url), 'utf8'), { merge: true })[
      Number(r.sourcePath.slice(1))
    ]
    expect(r.definitionSha256).toBe(
      createHash('sha256')
        .update(JSON.stringify(normalize(d)))
        .digest('hex'),
    )
    expect(r.recipe.repairedPaths).toEqual([])
    expect(r.recipe.pathRepairs).toBeUndefined()
    return [id, d]
  }),
)
const oracles = new Map(ids.map(id => [id, EffectParser.parse(definitions.get(id))]))
const battles: Battle[] = [],
  errors: unknown[][] = []
beforeAll(() =>
  setGlobalLogger({
    debug() {},
    info() {},
    warn() {},
    error(...args) {
      errors.push(args)
    },
  }),
)
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
  expect(errors.splice(0)).toEqual([])
})
const variants = [
  'normal',
  'repeat',
  'late-owner',
  'cancel',
  'remove',
  'after-remove',
  'other-skill',
  'second-tag',
  'empty-skills',
] as const
function run(id: Id, native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number], override?: number) {
  const { battle, a, b, debuff } = makeScenario(2501)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) for (const s of p.skills) s.effects.splice(0)
  const d = definitions.get(id)!,
    skill = a.activePet.skills[0]
  const mark = new BaseMark('fixture/contribution' as baseMarkId, [], {
    ...debuff.config,
    duration: -1,
    maxStacks: 20,
  }).createInstance()
  mark.setOwner(a.activePet, battle.emitter)
  a.activePet.marks.push(mark)
  const source = kind === 'mark' ? mark : skill
  const added = new SkillInstance(
    new BaseSkill(
      (variant === 'other-skill' ? 'fixture/other' : 'skill_jingsongzhiyan') as baseSkillId,
      Category.Status,
      Element.Normal,
      0,
      80,
      0,
      0,
      AttackTargetOpinion.opponent,
      1,
      false,
      false,
      false,
      undefined,
      variant === 'other-skill' ? [] : variant === 'second-tag' ? ['other', 'xifa'] : ['xifa'],
    ),
  )
  added.setOwner(a.activePet)
  a.activePet.skills.push(added)
  source.effects.push(native ? generatedAttributeContributions[id] : oracles.get(id)!)
  if (native) effectAuthoring.effectParameters(generatedAttributeContributions[id]).install(battle.configSystem)
  if (override !== undefined) {
    const key = native ? parameterAddress(id, 'parameters', 'action0_value') : `${id}.evasion_increase`
    battle.configSystem.set(key, override, source)
  }
  const all = [...a.team, ...b.team, added]
  const read = () => all.map(p => p.attributeSystem.getAttribute$(d.apply.stat).value)
  const before = read()
  const parent = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill)
  const event = new AddMarkContext(parent, a.activePet, mark.base)
  let admitted = 0
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/contribution-observer' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        admitted++
        if (variant === 'late-owner') source.setOwner(a.team[1], battle.emitter)
        if (variant === 'cancel' && c.parent instanceof EffectContext) c.parent.available = false
      },
    }),
  )
  if (variant === 'empty-skills') a.activePet.skills = []
  // Explicit source dispatch also exercises skill-owned contributions independent of registration.
  const fire = () =>
    battle.applyEffects<EffectTrigger>(d.trigger === 'OnBattleStart' ? battle : event, d.trigger, source)
  fire()
  if (variant === 'repeat') fire()
  const applied = read()
  if (variant === 'remove' || variant === 'after-remove') battle.removeMark(new RemoveMarkContext(parent, mark))
  const removed = read()
  if (variant === 'after-remove') fire()
  return { before, applied, removed, final: read(), admitted, active: mark.isActive }
}
for (const id of ids)
  for (const kind of ['skill', 'mark'] as const)
    for (const variant of variants)
      it(`${id}/${kind}/${variant}`, () => expect(run(id, true, kind, variant)).toEqual(run(id, false, kind, variant)))
for (const id of ids.filter(id => id !== 'effect_ability_increase_accuracy_5_percent_if_height_above_100'))
  it(`source removal cleans ${id}`, () => {
    const r = run(id, true, 'mark', 'remove')
    expect(r.applied).not.toEqual(r.before)
    expect(r.removed).toEqual(r.before)
  })
for (const value of [-12.5, 0, 7, 30])
  it(`configured contribution ${value}`, () =>
    expect(run('effect_mark_increase_evasion_15_percent', true, 'mark', 'normal', value)).toEqual(
      run('effect_mark_increase_evasion_15_percent', false, 'mark', 'normal', value),
    ))
it('direct skill event chooses actor team and skills; queries refresh after owner changes', () => {
  const { battle, a, b } = makeScenario(2502)
  battles.push(battle)
  const source = b.activePet.skills[0],
    use = new UseSkillContext(
      new TurnContext(battle),
      a,
      a.activePet,
      AttackTargetOpinion.opponent,
      a.activePet.skills[0],
    )
  use.updateActualTarget()
  const { compileEffect, defineEffect, targets } = effectAuthoring
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/team-query',
      on: 'BeforeUseSkillCheck',
      execute(ctx) {
        expect(ctx.read(targets.selfTeam.all())).toEqual(a.team)
        expect(ctx.read(targets.selfSkills.all())).toEqual(a.activePet.skills)
      },
    }),
  )
  battle.executionBudget.run(battle.currentTurn, () =>
    effect.innerApply(new EffectContext(use, EffectTrigger.BeforeUseSkillCheck, source, effect)),
  )
})

for (const skillTarget of [false, true])
  it(`per-target sampling, append and source lifetime ${skillTarget}`, () => {
    const { battle, a, debuff } = makeScenario(2503)
    battles.push(battle)
    const source = new BaseMark('fixture/lifetime' as baseMarkId, [], {
      ...debuff.config,
      duration: -1,
    }).createInstance()
    source.setOwner(a.activePet, battle.emitter)
    a.activePet.marks.push(source)
    const pets = [a.activePet, a.team[1]],
      skills = pets.map(p => p.skills[0])
    const targets = skillTarget ? skills : pets
    const read = () =>
      targets.map(p => {
        const value = p.attributeSystem.getAttribute$('accuracy').value
        if (typeof value !== 'number') throw new Error('Expected numeric accuracy')
        return value
      })
    const before = read(),
      order: string[] = []
    let samples = 0
    const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
    const amount = selectFrom([0])
      .first()
      .map(() => {
        order.push('amount')
        return ++samples
      })
    const priority = selectFrom([0])
      .first()
      .map(() => {
        order.push('priority')
        return 0
      })
    const effect = compileEffect(
      defineEffect({
        id: 'fixture/contribution-order',
        on: 'TurnStart',
        execute: skillTarget
          ? selectFrom(skills).apply(ops.addSkillAttributeModifier('accuracy', 'delta', amount, { priority }))
          : selectFrom(pets).apply(ops.addAttributeModifier('accuracy', 'delta', amount, priority)),
      }),
    )
    const fire = () =>
      battle.executionBudget.run(battle.currentTurn, () =>
        effect.innerApply(new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, source, effect)),
      )
    fire()
    fire()
    expect(order).toEqual(['amount', 'priority', 'amount', 'priority', 'amount', 'priority', 'amount', 'priority'])
    const applied = [before[0] + 4, before[1] + 6]
    expect(read()).toEqual(applied)
    source.isSuppressed = true
    expect(read()).toEqual(before)
    source.isSuppressed = false
    expect(read()).toEqual(applied)
    source.isActive = false
    expect(read()).toEqual(before)
    source.isActive = true
    expect(read()).toEqual(applied)
    battle.removeMark(
      new RemoveMarkContext(
        new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, a.activePet.skills[0]),
        source,
      ),
    )
    expect(read()).toEqual(before)
  })
for (const skillTarget of [false, true])
  for (const variant of ['foreign', 'move-during-read', 'invalid', 'empty'] as const)
    it(`modifier input guard ${skillTarget}/${variant}`, () => {
      const own = makeScenario(2504),
        foreign = makeScenario(2505)
      battles.push(own.battle, foreign.battle)
      const { battle, a } = own,
        source = a.activePet.skills[0]
      const pet = variant === 'foreign' ? foreign.a.activePet : a.activePet
      const target = skillTarget ? pet.skills[0] : pet
      const before = target.attributeSystem.getAttribute$('accuracy').value
      let reads = 0
      const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
      const input = selectFrom(variant === 'empty' ? [] : [1])
        .first()
        .map(() => {
          reads++
          if (variant === 'move-during-read') {
            if (skillTarget) pet.skills[0].setOwner(foreign.a.activePet)
            else pet.setOwner(foreign.a, battle.emitter)
          }
          return variant === 'invalid' ? Infinity : 5
        })
      const execute = skillTarget
        ? selectFrom([pet.skills[0]]).apply(ops.addSkillAttributeModifier('accuracy', 'delta', input))
        : selectFrom([pet]).apply(ops.addAttributeModifier('accuracy', 'delta', input))
      const effect = compileEffect(defineEffect({ id: 'fixture/contribution-guard', on: 'TurnStart', execute }))
      const fire = () =>
        battle.executionBudget.run(battle.currentTurn, () =>
          effect.innerApply(new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, source, effect)),
        )
      if (variant === 'empty') fire()
      else expect(fire).toThrow(variant === 'invalid' ? 'finite' : 'Cross-battle')
      expect(target.attributeSystem.getAttribute$('accuracy').value).toBe(before)
      expect(reads).toBe(variant === 'foreign' || variant === 'empty' ? 0 : 1)
    })
