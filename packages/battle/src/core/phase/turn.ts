import { EffectTrigger } from '@arcadia-eternity/const'
import { TurnContext, UseSkillContext, SwitchPetContext, RageContext } from '../context.js'
import { copyData } from '../data.js'
import type { SkillPlan } from '../continuation.js'
import { SynchronousPhase } from './base.js'
import { SkillPhase } from './skill.js'
import { SwitchPetPhase } from './switch.js'
import { MarkCleanupPhase, MarkUpdatePhase } from './mark.js'
import { prepareNextDecision } from './battleSwitch.js'

export function saveSkillPlan(ctx: UseSkillContext): SkillPlan {
  return copyData({
    available: ctx.available,
    power: ctx.power,
    accuracy: ctx.accuracy,
    rage: ctx.rage,
    category: ctx.category,
    element: ctx.element,
    priority: ctx.priority,
    ignoreStageStrategy: ctx.ignoreStageStrategy,
    petAccuracy: ctx.petAccuracy,
    critRate: ctx.critRate,
    evasion: ctx.evasion,
    ignoreShield: ctx.ignoreShield,
    multihit: ctx.multihit,
    hitOverrides: ctx.hitOverrides,
    critOverrides: ctx.critOverrides,
  })
}
export class TurnStartPhase extends SynchronousPhase<TurnContext> {
  readonly kind = 'turn-start'
  protected executeOperation() {
    const battle = this.battle,
      ctx = this.context
    battle.turn = ctx.data.number
    battle.lastKillerId = null
    battle.emitEvent('turnStart', { turn: battle.turn })
    const queue = battle.phase.queue
    for (const item of queue)
      if (item.action.type === 'use-skill') {
        const skill = new UseSkillContext(
          ctx,
          battle.getPlayerByID(item.action.player),
          battle.getPetByID(item.actorPetId),
          item.action.target,
          battle.getSkillByID(item.action.skill),
        )
        battle.applyEffects(skill, EffectTrigger.BeforeSort)
        item.skillPlan = saveSkillPlan(skill)
      }
    queue.sort((a, b) => {
      if (a.action.type !== b.action.type && (a.action.type === 'switch-pet' || b.action.type === 'switch-pet'))
        return a.action.type === 'switch-pet' ? -1 : 1
      if (a.action.type === 'use-skill' && b.action.type === 'use-skill')
        return (
          (b.skillPlan?.priority ?? 0) - (a.skillPlan?.priority ?? 0) ||
          battle.getPetByID(b.actorPetId).stat.spe - battle.getPetByID(a.actorPetId).stat.spe
        )
      return 0
    })
    ctx.data.plannedPetIds = queue.filter(item => item.action.type === 'use-skill').map(item => item.actorPetId)
    battle.applyEffects(ctx, EffectTrigger.TurnStart)
    battle.phase.kind = 'action'
  }
}
export class TurnActionPhase extends SynchronousPhase<TurnContext> {
  readonly kind = 'turn-action'
  protected executeOperation() {
    const battle = this.battle,
      ctx = this.context,
      next = battle.phase.queue.shift()
    if (!next) {
      battle.phase.kind = 'turn-end'
      return
    }
    const player = battle.getPlayerByID(next.action.player)
    if (next.action.type === 'switch-pet')
      battle.phaseManager.executeSync(
        new SwitchPetPhase(new SwitchPetContext(ctx, player, battle.getPetByID(next.action.pet))),
      )
    if (next.action.type === 'use-skill') {
      const skill = Object.assign(
        new UseSkillContext(
          ctx,
          player,
          battle.getPetByID(next.actorPetId),
          next.action.target,
          battle.getSkillByID(next.action.skill),
        ),
        copyData(next.skillPlan ?? {}),
      )
      ctx.data.executedPetIds.push(next.actorPetId)
      battle.phaseManager.executeSync(new SkillPhase(skill))
    }
    battle.phaseManager.executeSync(new MarkCleanupPhase(ctx))
  }
}
export class TurnEndPhase extends SynchronousPhase<TurnContext> {
  readonly kind = 'turn-end'
  protected executeOperation() {
    const battle = this.battle,
      ctx = this.context
    battle.applyEffects(ctx, EffectTrigger.TurnEnd)
    for (const player of battle.players)
      battle.changeRage(new RageContext(ctx, player, player.activePet.stat.ragePerTurn, 'add', 'turn'))
    for (const mark of battle.getActiveMarks()) battle.phaseManager.executeSync(new MarkUpdatePhase(ctx, mark))
    battle.phaseManager.executeSync(new MarkCleanupPhase(ctx))
    battle.emitEvent('turnEnd', { turn: battle.turn })
    battle.activeTurn = null
    prepareNextDecision(battle)
  }
}

/** Owns the staged execution of one turn while keeping the same typed TurnContext. */
export class TurnPhase extends SynchronousPhase<TurnContext> {
  readonly kind = 'turn'
  protected executeOperation() {
    switch (this.battle.phase.kind) {
      case 'turn-start':
        this.battle.phaseManager.executeSync(new TurnStartPhase(this.context))
        break
      case 'action':
        this.battle.phaseManager.executeSync(new TurnActionPhase(this.context))
        break
      case 'turn-end':
        this.battle.phaseManager.executeSync(new TurnEndPhase(this.context))
        break
      default:
        throw new Error('TurnPhase requires a turn continuation')
    }
  }
}
