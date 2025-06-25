import { EffectTrigger, BattleMessageType, BattleStatus, BattlePhase } from '@arcadia-eternity/const'
import { InteractivePhase } from './base'
import { TurnContext, RageContext, UseSkillContext, SwitchPetContext } from '../context'
import { SkillPhase, executeSkillOperation } from './skill'
import { SwitchPetPhase, executeSwitchPetOperation } from './switch'
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

  // Process player selections and create action phases
  for (const selection of [battle.playerA.selection, battle.playerB.selection]) {
    const player = battle.getPlayerByID(selection.player)

    switch (selection.type) {
      case 'use-skill': {
        const skill = battle.getSkillByID(selection.skill)
        const skillPhase = new SkillPhase(battle, player, player.activePet, skill.target, skill, context)

        // Initialize and queue the skill phase
        skillPhase.initialize()
        battle.applyEffects(skillPhase.context!, EffectTrigger.BeforeSort)
        context.pushContext(skillPhase.context!)

        // Note: No need to push to contextQueue separately,
        // it will be copied from contexts array later
        break
      }
      case 'switch-pet': {
        const pet = battle.getPetByID(selection.pet)
        const switchPhase = new SwitchPetPhase(battle, player, pet, context)

        // Initialize and queue the switch phase
        switchPhase.initialize()
        context.pushContext(switchPhase.context!)

        // Note: No need to push to contextQueue separately,
        // it will be copied from contexts array later
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

    // Execute all queued contexts
    context.contextQueue = context.contexts.slice()
    while (context.contextQueue.length > 0) {
      const nowContext = context.contextQueue.pop()
      if (!nowContext) break

      context.appledContexts.push(nowContext)

      switch (nowContext.type) {
        case 'use-skill': {
          const _context = nowContext as UseSkillContext
          // Execute skill operation directly
          executeSkillOperation(_context, battle)
          break
        }
        case 'switch-pet': {
          const _context = nowContext as SwitchPetContext
          // Execute switch operation directly
          executeSwitchPetOperation(_context, battle)
          break
        }
      }

      // Use MarkCleanupPhase instead of direct cleanupMarks call
      const markCleanupPhase = new MarkCleanupPhase(battle, context)
      markCleanupPhase.initialize()
      markCleanupPhase.execute()
    }

    // Apply TurnEnd effects before adding rage (correct timing)
    battle.applyEffects(context, EffectTrigger.TurnEnd)
    addTurnRage(context, battle) // Add rage at turn end
    updateTurnMark(context, battle)

    // Use MarkCleanupPhase instead of direct cleanupMarks call
    const finalMarkCleanupPhase = new MarkCleanupPhase(battle, context)
    finalMarkCleanupPhase.initialize()
    finalMarkCleanupPhase.execute()
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
