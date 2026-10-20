import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  createAutomaticStackConsumption,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  ConsumeStackContext,
  AttackTargetOpinion,
  Category,
  SkillPhase,
  SkillInstance,
  BattleMessageType,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const candidates = createAutomaticStackConsumption()
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
  'status',
  'climax',
  'wrong-owner',
  'wrong-skill',
  'nested',
  'cancel-effect',
  'cancel-consume',
  'late-category',
  'last-stack',
  'repeat',
  'suppressed',
  'phase-hit',
  'phase-miss',
  'phase-disabled',
  'phase-no-rage',
  'phase-zero-hits',
  'phase-multihit',
] as const
function run(id: keyof typeof candidates, native: boolean, kind: 'mark' | 'skill', variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(719)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const owner = a.activePet,
    skill = owner.skills[0]
  const mark = new BaseMark('fixture/auto-consume' as baseMarkId, [], {
    ...debuff.config,
    maxStacks: 20,
    persistent: true,
    duration: -1,
  }).createInstance()
  mark.setOwner(owner, battle.emitter)
  mark.stack = variant === 'last-stack' ? 1 : 5
  owner.marks.push(mark)
  mark.isSuppressed = variant === 'suppressed'
  const otherSkill = new SkillInstance(skill.base)
  otherSkill.setOwner(owner)
  owner.skills.push(otherSkill)
  const source = kind === 'mark' ? mark : skill
  source.effects.push(native ? candidates[id] : EffectParser.parse(definitions.find(d => d.id === id)!))
  const use = new UseSkillContext(
    new TurnContext(battle),
    a,
    variant === 'wrong-owner' ? a.team[1] : owner,
    AttackTargetOpinion.opponent,
    variant === 'wrong-skill' ? owner.skills[1] : skill,
  )
  use.updateActualTarget()
  use.category = variant === 'status' ? Category.Status : variant === 'climax' ? Category.Climax : Category.Physical
  use.hitOverrides.push({ willHit: variant !== 'phase-miss', priority: 1000 })
  use.available = variant !== 'phase-disabled'
  use.multihit = variant === 'phase-multihit' ? 3 : variant === 'phase-zero-hits' ? 0 : 1
  a.currentRage = variant === 'phase-no-rage' ? 0 : a.maxRage
  if (variant === 'phase-no-rage') use.rage = 1
  b.activePet.attributeSystem.updateBaseValue('maxHp', 10000)
  b.activePet.currentHp = 10000
  const trace: unknown[] = []
  let applications = 0
  b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/auto-observer' as effectId,
      triggers: [
        EffectTrigger.BeforeEffect,
        EffectTrigger.AfterEffect,
        EffectTrigger.OnBeforeConsumeStack,
        EffectTrigger.OnConsumeStack,
      ],
      when: ctx =>
        ctx.parent instanceof ConsumeStackContext ||
        (ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id),
      apply: ctx => {
        if (ctx.parent instanceof ConsumeStackContext) {
          trace.push([ctx.trigger, ctx.parent.requestedAmount, mark.stack])
          if (variant === 'cancel-consume' && ctx.trigger === EffectTrigger.OnBeforeConsumeStack)
            ctx.parent.available = false
        } else if (ctx.parent instanceof EffectContext) {
          trace.push([ctx.trigger, mark.stack])
          if (ctx.trigger === EffectTrigger.BeforeEffect) {
            applications++
            if (variant === 'cancel-effect') ctx.parent.available = false
            if (variant === 'late-category') use.category = Category.Status
          }
        }
      },
    }),
  )
  battle.registerListener(message => {
    if (message.type === BattleMessageType.MarkUpdate && message.data.mark.id === mark.id)
      trace.push(['update', message.data.mark.stack])
    if (message.type === BattleMessageType.SkillUseEnd) trace.push(['end', mark.stack])
  })
  if (variant.startsWith('phase-')) {
    const phase = new SkillPhase(battle, a, owner, AttackTargetOpinion.opponent, skill, use.parent, use)
    battle.phaseManager.registerPhase(phase)
    battle.phaseManager.executePhase(phase.id)
  } else {
    const trigger = candidates[id].trigger
    const parent = variant === 'nested' ? new EffectContext(use, trigger, source) : use
    battle.applyEffects(parent, trigger, source)
    if (variant === 'repeat') battle.applyEffects(parent, trigger, source)
  }
  return { stack: mark.stack, active: mark.isActive, applications, trace, next: battle.random() }
}
for (const id of Object.keys(candidates) as (keyof typeof candidates)[])
  for (const kind of ['mark', 'skill'] as const)
    for (const variant of variants)
      it(`${id} ${kind} ${variant}`, () => {
        const actual = run(id, true, kind, variant)
        expect(actual).toEqual(run(id, false, kind, variant))
        const end = id === 'effect_mark_consume_stack_on_skill_use'
        const admitted = !(
          ['status', 'wrong-owner', 'phase-disabled', 'phase-no-rage'].includes(variant) ||
          (variant === 'climax' && end) ||
          (variant === 'wrong-skill' && kind === 'skill') ||
          (variant === 'suppressed' && kind === 'mark') ||
          (['phase-miss', 'phase-zero-hits'].includes(variant) && !end)
        )
        const count = variant === 'repeat' ? 2 : variant === 'phase-multihit' && !end ? 3 : 1
        expect(actual.applications).toBe(admitted ? count : 0)
        const spent = kind === 'mark' && admitted && !['cancel-effect', 'cancel-consume'].includes(variant) ? count : 0
        expect(actual.stack).toBe((variant === 'last-stack' ? 1 : 5) - spent)
        expect(actual.active).toBe(actual.stack > 0)
        if (variant === 'phase-hit' || variant === 'phase-multihit' || variant === 'phase-miss')
          expect(actual.trace.at(-1)).toEqual(['end', actual.stack])
      })

it('dispatches skill completion after mark cleanup and before the completion message', () => {
  const { battle, a, b, debuff } = makeScenario(720)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const stale = new BaseMark('fixture/stale' as baseMarkId, [], debuff.config).createInstance()
  stale.setOwner(a.activePet, battle.emitter)
  stale.isActive = false
  a.activePet.marks.push(stale)
  const order: string[] = []
  const skill = a.activePet.skills[0]
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/completion-order' as effectId,
      triggers: [EffectTrigger.SkillUseEnd],
      apply(ctx) {
        expect(ctx.parent).toBe(use)
        expect(a.activePet.marks).not.toContain(stale)
        order.push('effect')
      },
    }),
  )
  battle.registerListener(message => {
    if (message.type === BattleMessageType.SkillUseEnd) order.push('message')
  })
  const use = new UseSkillContext(new TurnContext(battle), a, a.activePet, AttackTargetOpinion.opponent, skill)
  use.hitOverrides.push({ willHit: false, priority: 1000 })
  a.currentRage = a.maxRage
  const phase = new SkillPhase(battle, a, a.activePet, AttackTargetOpinion.opponent, skill, use.parent, use)
  battle.phaseManager.registerPhase(phase)
  battle.phaseManager.executePhase(phase.id)
  expect(order).toEqual(['effect', 'message'])
})
