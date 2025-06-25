import { EffectTrigger, BattleMessageType, BattleStatus, BattlePhase } from '@arcadia-eternity/const'
import { InteractivePhase } from './base'
import { TurnContext, RageContext, UseSkillContext, SwitchPetContext } from '../context'
import { SkillPhase } from './skill'
import { SwitchPetPhase } from './switch'
import { MarkCleanupPhase } from './mark'
import type { Battle } from '../battle'

/**
 * TurnPhase handles turn execution operations
 * Corresponds to TurnContext and replaces performTurn logic
 */
export class TurnPhase extends InteractivePhase<TurnContext> {
  constructor(battle: Battle, id?: string) {
    super(battle, id)
  }

  protected createContext(): TurnContext {
    return new TurnContext(this.battle)
  }

  protected getEffectTriggers() {
    return {
      before: [],
      during: [], // Individual actions handle their own effects
      after: [], // TurnEnd is handled manually in executeTurnOperation for correct timing
    }
  }

  protected async executeOperation(): Promise<void> {
    const context = this._context!

    // Execute the turn operation logic (extracted from performTurn)
    // Note: executeTurnOperation is synchronous but we wrap it in async
    executeTurnOperation(context, this.battle)
  }
}

/**
 * Extracted turn operation logic from Battle.performTurn
 * This function contains the core turn execution logic
 */
export function executeTurnOperation(context: TurnContext, battle: Battle): void {
  if (!battle.playerA.selection || !battle.playerB.selection) {
    throw new Error('有人还未选择好！')
  }

  battle.currentTurn++

  battle.emitMessage(BattleMessageType.TurnStart, {
    turn: battle.currentTurn,
  })

  // Process player selections and create contexts for queuing
  for (const selection of [battle.playerA.selection, battle.playerB.selection]) {
    const player = battle.getPlayerByID(selection.player)

    switch (selection.type) {
      case 'use-skill': {
        const skill = battle.getSkillByID(selection.skill)
        // Create UseSkillContext and push to queue for sorting
        const useSkillContext = new UseSkillContext(context, player, player.activePet, skill.target, skill)
        battle.applyEffects(useSkillContext, EffectTrigger.BeforeSort)
        context.pushContext(useSkillContext)
        break
      }
      case 'switch-pet': {
        const pet = battle.getPetByID(selection.pet)
        // Create SwitchPetContext and push to queue for sorting
        const switchPetContext = new SwitchPetContext(context, player, pet)
        context.pushContext(switchPetContext)
        break
      }
      case 'do-nothing':
        // Do nothing
        break
      case 'surrender': {
        const player = battle.getPlayerByID(selection.player)
        battle.victor = battle.getOpponent(player)
        battle.status = BattleStatus.Ended
        battle.currentPhase = BattlePhase.Ended
        // 停止所有计时器
        battle.timerManager.stopAllTimers()
        battle.getVictor(true)
        return
      }
      default:
        throw new Error('未知的context')
    }
  }

  try {
    battle.applyEffects(context, EffectTrigger.TurnStart)

    // Execute all queued contexts in sorted order
    context.contextQueue = context.contexts.slice()
    while (context.contextQueue.length > 0) {
      const nowContext = context.contextQueue.shift() // 从队列开头取元素，按排序顺序执行
      if (!nowContext) break

      context.appledContexts.push(nowContext)

      switch (nowContext.type) {
        case 'use-skill': {
          const _context = nowContext as UseSkillContext
          // Create and execute SkillPhase
          const skillPhase = new SkillPhase(
            battle,
            _context.origin,
            _context.pet,
            _context.selectTarget,
            _context.skill,
            context,
          )
          battle.phaseManager.registerPhase(skillPhase)
          battle.phaseManager.executePhase(skillPhase.id)
          break
        }
        case 'switch-pet': {
          const _context = nowContext as SwitchPetContext
          // Create and execute SwitchPetPhase
          const switchPhase = new SwitchPetPhase(battle, _context.origin, _context.switchInPet, context)
          battle.phaseManager.registerPhase(switchPhase)
          battle.phaseManager.executePhase(switchPhase.id)
          break
        }
      }

      // Use MarkCleanupPhase managed by PhaseManager
      const markCleanupPhase = new MarkCleanupPhase(battle, context)
      battle.phaseManager.registerPhase(markCleanupPhase)
      battle.phaseManager.executePhase(markCleanupPhase.id)
    }

    // Apply TurnEnd effects before adding rage (correct timing)
    battle.applyEffects(context, EffectTrigger.TurnEnd)
    addTurnRage(context, battle) // Add rage at turn end
    updateTurnMark(context, battle)

    // Use MarkCleanupPhase managed by PhaseManager
    const finalMarkCleanupPhase = new MarkCleanupPhase(battle, context)
    battle.phaseManager.registerPhase(finalMarkCleanupPhase)
    battle.phaseManager.executePhase(finalMarkCleanupPhase.id)
  } finally {
    battle.emitMessage(BattleMessageType.TurnEnd, {
      turn: battle.currentTurn,
    })
  }
}

/**
 * Add rage to all players at turn end
 */
function addTurnRage(context: TurnContext, battle: Battle): void {
  ;[battle.playerA, battle.playerB].forEach(player => {
    player.addRage(new RageContext(context, player, 'turn', 'add', player.activePet.stat.ragePerTurn))
  })
}

/**
 * Update turn-based marks
 */
function updateTurnMark(context: TurnContext, battle: Battle): void {
  ;[battle.playerA, battle.playerB].forEach(player => {
    player.activePet.marks.forEach(mark => mark.update(context))
    player.activePet.marks = player.activePet.marks.filter(mark => mark.isActive)
  })
}
