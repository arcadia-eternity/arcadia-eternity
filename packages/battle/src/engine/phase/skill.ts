import { changeRage } from './rage'
import { addMark } from './AddMarkPhase'
import { z } from 'zod'
import { ElementSchema } from '../content/schema/element'
import { BaseMark, BaseStatLevelMark } from '../mark'
import {
  EffectTrigger,
  Category,
  BattleMessageType,
  DamageType,
  ELEMENT_CHART,
  elementMultiplier,
  type DamageOrigin,
  type Element,
  IgnoreStageStrategy,
} from '@arcadia-eternity/const'
import type { Battle } from '../battle'
import type { SkillInstance } from '../skill'
import type { Pet } from '../pet'
import { ContextPhase } from './base'
import { dealDamage } from './damage'
import {
  AddMarkContext,
  DamageContext,
  type EffectContext,
  UseSkillContext,
  RageContext,
  TurnContext,
} from '../context'
import { MarkCleanupPhase } from './MarkCleanupPhase'

export class SkillPhase extends ContextPhase<UseSkillContext> {
  protected executeOperation(): void {
    const context = this.event
    const battle = this.battle
    if (context.parent instanceof TurnContext) context.parent.appledContexts.push(context)

    // Update skill usage tracking
    if (context.pet.lastSkill && context.pet.lastSkill.baseId === context.skill.baseId) {
      context.pet.lastSkillUsedTimes += 1
    } else {
      context.pet.lastSkill = context.skill
      context.pet.lastSkillUsedTimes = 1
    }
    context.skill.appeared = true

    // Apply before effects
    battle.applyEffects(context, EffectTrigger.BeforeUseSkillCheck)
    context.updateActualTarget()

    // Check if skill can be used
    if (context.pet.currentHp <= 0 || !context.pet.isAlive || !context.available || !context.actualTarget) {
      battle.emitMessage(BattleMessageType.SkillUseFail, {
        user: context.pet.id,
        skill: context.skill.id,
        reason: !context.pet.isAlive ? 'faint' : !context.actualTarget ? 'invalid_target' : 'disabled',
      })
      return
    }

    // Check rage requirement
    if (context.origin.currentRage < context.rage) {
      battle.emitMessage(BattleMessageType.SkillUseFail, {
        user: context.pet.id,
        skill: context.skill.id,
        reason: 'no_rage',
      })
      return
    }

    context.previousSkillElement = context.pet.lastUsedSkillElement

    // Emit skill use message
    battle.emitMessage(BattleMessageType.SkillUse, {
      user: context.pet.id,
      target: context.selectTarget,
      skill: context.skill.id,
      baseSkill: context.skill.baseId,
      rage: context.rage,
    })

    try {
      // Consume rage
      changeRage(new RageContext(context, context.origin, 'skill', 'reduce', context.rage))

      // Apply after skill check effects
      battle.applyEffects(context, EffectTrigger.AfterUseSkillCheck)

      // Update hit, multihit, and crit results
      context.updateHitResult()
      context.updateMultihitResult()
      context.updateCritResult()

      // Apply before multihit effects
      battle.applyEffects(context, EffectTrigger.BeforeMultiHit)

      let landedHit = false
      // Execute multihit loop
      for (; context.currentHitCount <= context.multihitResult; context.currentHitCount++) {
        if (!context.pet.isAlive || !context.actualTarget.isAlive) break
        // Hit check
        if (!context.hitResult) {
          battle.emitMessage(BattleMessageType.SkillMiss, {
            user: context.pet.id,
            target: context.actualTarget.id,
            skill: context.skill.id,
            reason: 'accuracy',
          })
          battle.applyEffects(context, EffectTrigger.OnMiss)
          // All subsequent hits will miss, no need to continue
          break
        } else {
          landedHit = true
          battle.applyEffects(context, EffectTrigger.BeforeHit)

          // Calculate damage for non-status moves
          if (context.category !== Category.Status && !context.damageDeferred) {
            if (context.actualTarget)
              Object.assign(context, calculateSkillDamage(battle, context.pet, context.actualTarget, context))

            if (context.crit) battle.applyEffects(context, EffectTrigger.OnCritPreDamage)
            battle.applyEffects(context, EffectTrigger.PreDamage)

            const damageContext = makeSkillDamageContext(context, context.skill, context.actualTarget, context)
            dealDamage(damageContext)
          }

          battle.applyEffects(context, EffectTrigger.OnHit) // Trigger hit effects
        }
      }

      context.pet.lastMissedSkillId = context.hitResult ? undefined : context.skill.baseId

      // Hit reward rage for non-status moves
      if (context.category !== Category.Status && landedHit) {
        changeRage(new RageContext(context, context.origin, 'skillHit', 'add', 15))
      }
    } finally {
      battle.phaseManager.run(new MarkCleanupPhase(battle, context.parent as TurnContext))

      context.pet.lastUsedSkillElement = context.element
      battle.applyEffects(context, EffectTrigger.SkillUseEnd)

      battle.emitMessage(BattleMessageType.SkillUseEnd, {
        user: context.pet.id,
      })
    }
  }
}

interface SkillDamageFormula {
  category: Category
  power: number
  element: Element
  ignoreStageStrategy: IgnoreStageStrategy
  crit: boolean
  stabMultiplier: number
  critMultiplier: number
  minimumTypeMultiplier?: number
}

/** A one-shot view of the current combatants, shared by immediate hits and mark expiry. */
export function calculateSkillDamage(battle: Battle, attacker: Pet, target: Pet, formula: SkillDamageFormula) {
  const attack = attacker.actualStat
  const defense = target.getEffectiveStat(false, formula.ignoreStageStrategy)
  const physical =
    formula.category === Category.Physical || (formula.category === Category.Climax && attack.atk > attack.spa)
  const ratio = physical ? attack.atk / defense.def : attack.spa / defense.spd
  const damageType = physical ? DamageType.Physical : DamageType.Special
  const typeMultiplier = Math.max(
    formula.minimumTypeMultiplier ?? 0,
    elementMultiplier(battle.elementMultipliers ?? ELEMENT_CHART, formula.element, target.element),
  )
  const base = Math.floor((((2 * target.level) / 5 + 2) * formula.power * ratio) / 50 + 2)
  const stab = attacker.element === formula.element ? formula.stabMultiplier : 1
  const critical = formula.crit ? formula.critMultiplier : 1
  return {
    damageType,
    typeMultiplier,
    baseDamage: Math.floor(base * typeMultiplier * stab * critical),
    randomFactor: battle.random() * 0.15 + 0.85,
  }
}

/** Construct one skill-formula strike; the parent can equally be an identity-bearing mark expiry. */
export function makeSkillDamageContext(
  parent: UseSkillContext | EffectContext<EffectTrigger>,
  skill: SkillInstance,
  target: Pet,
  hit: ReturnType<typeof calculateSkillDamage> & Pick<UseSkillContext, 'crit' | 'ignoreShield' | 'element'>,
  origin?: DamageOrigin,
): DamageContext {
  const proposal = new DamageContext(
    parent,
    skill,
    target,
    hit.baseDamage,
    hit.damageType,
    hit.crit,
    hit.typeMultiplier,
    hit.ignoreShield,
    hit.randomFactor,
    undefined,
    undefined,
    undefined,
    hit.element,
    origin,
  )
  if (parent instanceof UseSkillContext) {
    for (const { sourceId, delta } of parent.paidDamageBonuses.splice(0)) proposal.addModified(0, delta, sourceId)
  }
  return proposal
}

const sourcePolicy = z.enum(['any', 'alive', 'active'])
const optionsSchema = z.strictObject({
  afterTurns: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  sourcePolicy: sourcePolicy.optional(),
  capturePower: z.boolean().optional(),
})
export type DeferredDamageOptions = z.input<typeof optionsSchema>

const id = z.string().min(1)
const descriptor = z
  .strictObject({
    kind: z.literal('damage'),
    evaluation: z.literal('on-trigger'),
    timing: z.literal('turn-end-mark-expiry'),
    id,
    origin: z.strictObject({ petId: id, skillId: id, skillInstanceId: id }).readonly(),
    target: z.strictObject({ kind: z.literal('active'), playerId: id }).readonly(),
    formula: z
      .strictObject({
        category: z.enum([Category.Physical, Category.Special, Category.Climax]),
        element: ElementSchema,
        tags: z.array(z.string()).readonly(),
        definitionPower: z.number().nonnegative(),
        capturedPower: z.number().nonnegative().optional(),
        ignoreStageStrategy: z.enum(IgnoreStageStrategy),
        ignoreShield: z.boolean(),
        sureCrit: z.boolean(),
      })
      .readonly(),
    sourcePolicy,
  })
  .readonly()
export type DeferredDamage = z.output<typeof descriptor>
export function readDeferredDamage(value: unknown): DeferredDamage {
  return descriptor.parse(value)
}

export function deferSkillDamage(
  effect: EffectContext<EffectTrigger>,
  cast: UseSkillContext,
  holder: BaseMark,
  options: DeferredDamageOptions,
): void {
  if (effect.trigger !== EffectTrigger.BeforeHit || effect.parent !== cast || effect.battle !== cast.battle)
    throw new Error('Deferred skill damage requires the current BeforeHit context')
  if (!(holder instanceof BaseMark) || holder instanceof BaseStatLevelMark)
    throw new Error('Deferred damage requires an ordinary mark prototype')
  if (cast.category === Category.Status || !cast.actualTarget?.owner)
    throw new Error('Deferred damage requires a damaging skill with an owned target')
  if (cast.damageDeferred) return
  const { afterTurns, sourcePolicy: policy = 'any', capturePower = false } = optionsSchema.parse(options)
  // The casting turn has its own mark-update step. Thus zero means the end of this turn.
  const duration = afterTurns + 1
  const application = new AddMarkContext(effect, cast.battle, holder, 1, duration, {
    ...holder.config,
    duration,
    persistent: false,
    destroyable: true,
  })
  application.deferredDamage = readDeferredDamage({
    kind: 'damage',
    evaluation: 'on-trigger',
    timing: 'turn-end-mark-expiry',
    id: cast.battle.allocateEventId('deferred'),
    origin: { petId: cast.pet.id, skillId: cast.skill.baseId, skillInstanceId: cast.skill.id },
    target: { kind: 'active', playerId: cast.actualTarget.owner.id },
    formula: {
      category: cast.category,
      element: cast.element,
      tags: cast.skill.tags,
      definitionPower: cast.skill.base.power,
      ...(capturePower ? { capturedPower: cast.power } : {}),
      ignoreStageStrategy: cast.skill.base.ignoreOpponentStageStrategy,
      ignoreShield: cast.skill.ignoreShield,
      sureCrit: cast.skill.sureCrit,
    },
    sourcePolicy: policy,
  })
  // A cancelled mark application also consumes the cast. It cannot fall back to immediate damage.
  cast.damageDeferred = true
  addMark(application)
}
