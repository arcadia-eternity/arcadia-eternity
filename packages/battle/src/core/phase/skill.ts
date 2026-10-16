import { Category, EffectTrigger, ELEMENT_CHART } from '@arcadia-eternity/const'
import { UseSkillContext, DamageContext, RageContext } from '../context.js'
import { SynchronousPhase } from './base.js'

export class SkillPhase extends SynchronousPhase<UseSkillContext> {
  readonly kind = 'skill'
  protected executeOperation() {
    const ctx = this.context,
      battle = this.battle,
      { player, pet, skill } = ctx
    ctx.updateActualTarget()
    battle.applyEffects(ctx, EffectTrigger.BeforeUseSkillCheck)
    const target = ctx.target
    const reason = !ctx.available
      ? 'disabled'
      : !pet.isAlive || player.activePet !== pet
        ? 'faint'
        : player.currentRage < ctx.rage
          ? 'noRage'
          : !target.isAlive
            ? 'noTarget'
            : null
    if (reason) {
      battle.emitEvent('skillFail', { petId: pet.id, skillId: skill.id, reason })
      return
    }
    pet.rememberSkill(skill)
    battle.emitEvent('skillUse', {
      petId: pet.id,
      skillId: skill.id,
      baseSkillId: skill.base.id,
      target: ctx.selectTarget,
      targetId: target.id,
      rage: ctx.rage,
    })
    battle.changeRage(new RageContext(ctx, player, ctx.rage, 'reduce', 'skill'))
    battle.applyEffects(ctx, EffectTrigger.AfterUseSkillCheck)
    ctx.updateMultihitResult()
    ctx.updateHitResult()
    if (!ctx.hit) {
      battle.emitEvent('skillMiss', { petId: pet.id, targetId: target.id, skillId: skill.id })
      battle.applyEffects(ctx, EffectTrigger.OnMiss)
    } else {
      ctx.updateCritResult()
      battle.applyEffects(ctx, EffectTrigger.BeforeMultiHit)
      for (ctx.currentHit = 1; ctx.currentHit <= ctx.hitCount && ctx.target.isAlive; ctx.currentHit++) {
        battle.applyEffects(ctx, EffectTrigger.BeforeHit)
        if (ctx.category !== Category.Status) this.hitDamage()
        battle.applyEffects(ctx, EffectTrigger.OnHit)
      }
      if (ctx.category !== Category.Status) battle.changeRage(new RageContext(ctx, player, 15, 'add', 'skillHit'))
    }
    if (!ctx.target.isAlive && !ctx.defeated) {
      ctx.defeated = true
      battle.lastKillerId = pet.id
      battle.emitEvent('petDefeated', { petId: ctx.target.id, killerId: pet.id })
      battle.applyEffects(ctx, EffectTrigger.OnDefeat)
    }
    battle.applyEffects(ctx, EffectTrigger.SkillUseEnd)
    battle.emitEvent('skillUseEnd', { petId: pet.id })
  }
  private hitDamage() {
    const ctx = this.context,
      battle = this.battle,
      { pet, target } = ctx
    const factor = 0.85 + battle.random() * 0.15,
      attackStats = pet.stat,
      defenseStats = target.getEffectiveStat(ctx.ignoreStageStrategy)
    const physical =
      ctx.category === Category.Physical || (ctx.category === Category.Climax && attackStats.atk > attackStats.spa)
    const effectiveness = ELEMENT_CHART[ctx.element][target.element],
      stab = pet.element === ctx.element ? 1.5 : 1
    const base = Math.floor(
      (((2 * pet.level) / 5 + 2) * ctx.power * (physical ? attackStats.atk : attackStats.spa)) /
        (physical ? defenseStats.def : defenseStats.spd) /
        50 +
        2,
    )
    const damage = new DamageContext(
      ctx,
      pet,
      target,
      Math.floor(base * effectiveness * stab * (ctx.crit ? 2 : 1)),
      physical ? 'Physical' : 'Special',
      ctx.crit,
      effectiveness,
      ctx.ignoreShield,
      factor,
    )
    ctx.damage = damage
    if (ctx.crit) battle.applyEffects(ctx, EffectTrigger.OnCritPreDamage)
    battle.applyEffects(ctx, EffectTrigger.PreDamage)
    const dealt = battle.damage(damage),
      gained = Math.floor((dealt * 49) / target.stat.maxHp)
    if (gained > 0) battle.changeRage(new RageContext(ctx, target.owner, gained, 'add', 'damage'))
  }
}
