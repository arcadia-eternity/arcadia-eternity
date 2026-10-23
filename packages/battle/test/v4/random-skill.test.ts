import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, Operators } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  BaseSkill,
  SkillInstance,
  BaseMark,
  UseSkillContext,
  TurnContext,
  EffectContext,
  EffectTrigger,
  AttackTargetOpinion,
  Category,
  Element,
  IgnoreStageStrategy,
  SkillPhase,
  BattleMessageType,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type baseSkillId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createRandomSkillSelection } from '@arcadia-eternity/data-pack-base/native'

const candidates = createRandomSkillSelection()
const definitions = parse(
  readFileSync(new URL('../../../../packs/base/data/effect_mark.yaml', import.meta.url), 'utf8'),
  { merge: true },
) as { id: string }[]
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'normal',
  'empty',
  'singleton',
  'exact-cost',
  'wrong-owner',
  'nested',
  'cancel',
  'late-rage',
  'late-pool',
  'repeat',
  'suppressed',
  'phase',
] as const
function run(
  id: keyof typeof candidates,
  native: boolean,
  kind: 'mark' | 'skill',
  variant: (typeof variants)[number],
  seed: number,
) {
  const { battle, a, b, debuff } = makeScenario(seed)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const owner = a.activePet,
    original = owner.skills[0]
  const options = [
    new BaseSkill(
      'skill_jingshenshikong' as baseSkillId,
      Category.Status,
      Element.Normal,
      0,
      70,
      5,
      4,
      AttackTargetOpinion.self,
      1,
      true,
      true,
      true,
      IgnoreStageStrategy.all,
    ),
    new BaseSkill(
      'fixture/random-second' as baseSkillId,
      Category.Status,
      Element.Water,
      20,
      80,
      10,
      9,
      AttackTargetOpinion.opponent,
      2,
    ),
    new BaseSkill(
      'fixture/random-expensive' as baseSkillId,
      Category.Status,
      Element.Fire,
      30,
      90,
      50,
      12,
      AttackTargetOpinion.self,
      1,
    ),
  ].map(base => {
    const skill = new SkillInstance(base)
    skill.setOwner(owner)
    return skill
  })
  owner.skills.splice(0, owner.skills.length, ...options)
  // Keep the effect's source owned without admitting it into the random pool.
  const mark = new BaseMark('fixture/random-source' as baseMarkId, [], {
    ...debuff.config,
    persistent: true,
    duration: -1,
  }).createInstance()
  mark.setOwner(owner, battle.emitter)
  owner.marks.push(mark)
  const source = kind === 'mark' ? mark : options[0]
  source.effects.push(native ? candidates[id] : EffectParser.parse(definitions.find(d => d.id === id)!))
  mark.isSuppressed = variant === 'suppressed'
  a.currentRage = variant === 'empty' ? 0 : variant === 'singleton' ? 5 : variant === 'exact-cost' ? 10 : 20
  const use = new UseSkillContext(
    new TurnContext(battle),
    a,
    variant === 'wrong-owner' ? a.team[1] : owner,
    AttackTargetOpinion.opponent,
    original,
  )
  use.updateActualTarget()
  use.priority = 99
  const trace: unknown[] = []
  let applications = 0
  b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/random-observer' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.AfterEffect],
      when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id,
      apply: ctx => {
        trace.push([ctx.trigger, use.skill.baseId, use.rage, use.priority])
        if (ctx.trigger === EffectTrigger.BeforeEffect && ctx.parent instanceof EffectContext) {
          applications++
          if (variant === 'cancel') ctx.parent.available = false
          if (variant === 'late-rage') a.currentRage = 5
          if (variant === 'late-pool') owner.skills.splice(0, owner.skills.length, options[2])
        }
      },
    }),
  )
  battle.registerListener(message => {
    if (message.type === BattleMessageType.SkillUse) trace.push(['use', message.data.baseSkill, message.data.rage])
    if (message.type === BattleMessageType.SkillUseFail) trace.push(['fail', message.data.reason])
  })
  if (variant === 'phase') {
    const phase = new SkillPhase(battle, a, owner, AttackTargetOpinion.opponent, original, use.parent, use)
    battle.phaseManager.registerPhase(phase)
    battle.phaseManager.executePhase(phase.id)
  } else {
    const parent = variant === 'nested' ? new EffectContext(use, EffectTrigger.BeforeUseSkillCheck, source) : use
    battle.applyEffects(parent, EffectTrigger.BeforeUseSkillCheck as EffectTrigger, source)
    if (variant === 'repeat') battle.applyEffects(parent, EffectTrigger.BeforeUseSkillCheck as EffectTrigger, source)
  }
  return {
    selected: use.skill.baseId,
    power: use.power,
    rage: use.rage,
    category: use.category,
    element: use.element,
    accuracy: use.accuracy,
    sureHit: Reflect.get(use, 'skillSureHit'),
    sureCrit: Reflect.get(use, 'skillSureCrit'),
    ignoreShield: use.ignoreShield,
    stage: use.ignoreStageStrategy,
    target: use.actualTarget === owner ? 'self' : 'opponent',
    multihit: use.multihit,
    priority: use.priority,
    applications,
    trace,
    next: battle.random(),
    playerRage: a.currentRage,
  }
}
for (const id of Object.keys(candidates) as (keyof typeof candidates)[])
  for (const kind of ['mark', 'skill'] as const)
    for (const variant of variants)
      for (const seed of [811, 812, 813])
        it(`${id} ${kind} ${variant} ${seed}`, () => {
          const actual = run(id, true, kind, variant, seed)
          expect(actual).toEqual(run(id, false, kind, variant, seed))
          expect(actual.priority).toBe(99)
          if (actual.selected === 'skill_jingshenshikong')
            expect(actual).toMatchObject({
              power: 0,
              rage: 5,
              accuracy: 70,
              category: Category.Status,
              target: 'self',
              sureHit: true,
              sureCrit: true,
              ignoreShield: true,
              stage: IgnoreStageStrategy.all,
              multihit: 1,
            })
          if (actual.selected === 'fixture/random-second')
            expect(actual).toMatchObject({
              power: 20,
              rage: 10,
              accuracy: 80,
              category: Category.Status,
              target: 'opponent',
              sureHit: false,
              sureCrit: false,
              ignoreShield: false,
              stage: IgnoreStageStrategy.none,
              multihit: 2,
            })

          const admitted = variant !== 'wrong-owner' && !(kind === 'mark' && variant === 'suppressed')
          expect(actual.applications).toBe(admitted ? (variant === 'repeat' ? 2 : 1) : 0)
          if (admitted && ['normal', 'exact-cost', 'nested', 'repeat', 'phase'].includes(variant)) {
            expect(['skill_jingshenshikong', 'fixture/random-second']).toContain(actual.selected)
            if (id.endsWith('except_jingshenshikong')) expect(actual.selected).toBe('fixture/random-second')
          }
        })

for (const update of [false, true])
  for (const variant of ['normal', 'duplicate', 'empty', 'missing'] as const)
    it(`setSkill reads once / update=${update} / ${variant}`, () => {
      function invoke(native: boolean) {
        const { battle, a } = makeScenario(820)
        battles.push(battle)
        const original = a.activePet.skills[0]
        const replacement = new SkillInstance(
          new BaseSkill(
            'fixture/replacement' as baseSkillId,
            Category.Status,
            Element.Water,
            41,
            63,
            7,
            100,
            AttackTargetOpinion.self,
          ),
        )
        replacement.setOwner(a.activePet)
        a.activePet.skills.push(replacement)
        const use = new UseSkillContext(new TurnContext(battle), a, a.activePet, AttackTargetOpinion.opponent, original)
        use.priority = 91
        use.updateActualTarget()
        const selected = variant === 'empty' ? [] : variant === 'duplicate' ? [use, use] : [use]
        let reads = 0
        const context = new EffectContext(use, EffectTrigger.BeforeUseSkillCheck, original)
        const read = () => {
          reads++
          return variant === 'missing' ? [] : [replacement]
        }
        if (native) {
          const { selectFrom, ops, compileEffect, defineEffect } = effectAuthoring
          const input = selectFrom([0]).flatMap(read).first()
          const effect = compileEffect(
            defineEffect({
              id: 'fixture/set-skill-read',
              on: 'BeforeUseSkillCheck',
              execute: selectFrom(selected).apply(ops.setSkill(input, update)),
            }),
          )
          battle.executionBudget.run(0, () => effect.innerApply(context))
        } else Operators.setSkill(read, update)(context, selected)
        return {
          reads,
          skill: use.skill.baseId,
          power: use.power,
          rage: use.rage,
          priority: use.priority,
          target: use.actualTarget === a.activePet,
        }
      }
      const actual = invoke(true)
      expect(actual).toEqual(invoke(false))
      expect(actual.reads).toBe(1)
      expect(actual.priority).toBe(91)
      if (update && !['empty', 'missing'].includes(variant))
        expect(actual).toMatchObject({ power: 41, rage: 7, target: true })
    })
