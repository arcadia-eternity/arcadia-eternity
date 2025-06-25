import { EffectTrigger, Category, BattleMessageType } from '@arcadia-eternity/const'
import { SynchronousPhase } from './base'
import { UseSkillContext, RageContext, DamageContext, TurnContext } from '../context'
import { MarkCleanupPhase } from './MarkCleanupPhase'
import type { Battle } from '../battle'
import type { Player } from '../player'
import type { Pet } from '../pet'
import type { SkillInstance } from '../skill'
import { AttackTargetOpinion } from '@arcadia-eternity/const'

/**
 * SkillPhase handles skill usage operations
 * Corresponds to UseSkillContext and replaces performAttack logic
 */
export class SkillPhase extends SynchronousPhase<UseSkillContext> {
  constructor(
    battle: Battle,
    private readonly origin: Player,
    private readonly pet: Pet,
    private readonly selectTarget: AttackTargetOpinion,
    private readonly skill: SkillInstance,
    private readonly parentContext: any, // TurnContext or other parent
    private readonly existingContext?: UseSkillContext, // Optional existing context
    id?: string,
  ) {
    super(battle, id)
  }

  // Public getters for sorting purposes (before context is initialized)
  public get skillInstance(): SkillInstance {
    return this.skill
  }

  public get petInstance(): Pet {
    return this.pet
  }

  protected createContext(): UseSkillContext {
    // Use existing context if provided, otherwise create new one
    return (
      this.existingContext ||
      new UseSkillContext(this.parentContext, this.origin, this.pet, this.selectTarget, this.skill)
    )
  }

  protected executeOperation(): void {
    const context = this._context!

    // Execute the skill operation logic (extracted from performAttack)
    executeSkillOperation(context, this.battle)
  }
}

/**
 * Extracted skill operation logic from Player.performAttack
 * This function contains the core skill execution logic
 */
export function executeSkillOperation(context: UseSkillContext, battle: Battle): void {
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
    context.origin.addRage(new RageContext(context, context.origin, 'skill', 'reduce', context.skill.rage))

    // Apply after skill check effects
    battle.applyEffects(context, EffectTrigger.AfterUseSkillCheck)

    // Update hit, multihit, and crit results
    context.updateHitResult()
    context.updateMultihitResult()
    context.updateCritResult()

    // Apply before multihit effects
    battle.applyEffects(context, EffectTrigger.BeforeMultiHit)

    // Execute multihit loop
    for (; context.multihitResult > 0; context.multihitResult--) {
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
        battle.applyEffects(context, EffectTrigger.BeforeHit)

        // Calculate damage for non-status moves
        if (context.category !== Category.Status) {
          context.updateDamageResult()

          if (context.crit) battle.applyEffects(context, EffectTrigger.OnCritPreDamage)
          battle.applyEffects(context, EffectTrigger.PreDamage)

          const damageContext = new DamageContext(
            context,
            context.pet,
            context.actualTarget,
            context.baseDamage,
            context.damageType,
            context.crit,
            context.typeMultiplier,
            context.ignoreShield,
            context.randomFactor,
            undefined,
            undefined,
            undefined,
            context.element,
          )

          // Apply damage
          context.actualTarget.damage(damageContext)

          // Target gains rage from taking damage
          const gainedRage = Math.floor((damageContext.damageResult * 49) / context.actualTarget.stat.maxHp)
          context.actualTarget.owner!.addRage(
            new RageContext(context, context.actualTarget.owner!, 'damage', 'add', gainedRage),
          )
        }

        battle.applyEffects(context, EffectTrigger.OnHit) // Trigger hit effects
      }
    }

    // Hit reward rage for non-status moves
    if (context.category !== Category.Status && context.hitResult) {
      context.origin.addRage(new RageContext(context, context.origin, 'skillHit', 'add', 15))
    }

    // Check for defeat
    if (context.actualTarget.currentHp <= 0) {
      battle.emitMessage(BattleMessageType.PetDefeated, {
        pet: context.actualTarget.id,
        killer: context.pet.id,
      })
      context.actualTarget.isAlive = false
      battle.applyEffects(context, EffectTrigger.OnDefeat) // Trigger defeat effects

      battle.lastKiller = context.origin
      context.defeated = true
    }
  } finally {
    // Use MarkCleanupPhase managed by PhaseManager
    const markCleanupPhase = new MarkCleanupPhase(battle, context.parent as TurnContext)
    battle.phaseManager.registerPhase(markCleanupPhase)
    battle.phaseManager.executePhase(markCleanupPhase.id)

    battle.emitMessage(BattleMessageType.SkillUseEnd, {
      user: context.pet.id,
    })
  }
}
