import { EffectTrigger, Category, BattleMessageType } from '@arcadia-eternity/const'
import { ContextPhase } from './base'
import { makeSkillDamageContext } from '../skillDamage'
import { UseSkillContext, RageContext, TurnContext } from '../context'
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
      context.origin.addRage(new RageContext(context, context.origin, 'skill', 'reduce', context.rage))

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
            context.updateDamageResult()

            if (context.crit) battle.applyEffects(context, EffectTrigger.OnCritPreDamage)
            battle.applyEffects(context, EffectTrigger.PreDamage)

            const damageContext = makeSkillDamageContext(context, context.skill, context.actualTarget, context)
            context.actualTarget.damage(damageContext)
          }

          battle.applyEffects(context, EffectTrigger.OnHit) // Trigger hit effects
        }
      }

      context.pet.lastMissedSkillId = context.hitResult ? undefined : context.skill.baseId

      // Hit reward rage for non-status moves
      if (context.category !== Category.Status && landedHit) {
        context.origin.addRage(new RageContext(context, context.origin, 'skillHit', 'add', 15))
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
