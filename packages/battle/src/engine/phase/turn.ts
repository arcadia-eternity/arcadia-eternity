import { changeRage } from './rage'
import { EffectTrigger, BattleMessageType, BattleStatus, BattlePhase } from '@arcadia-eternity/const'
import { InteractivePhase } from './base'
import { TurnContext, RageContext, UseSkillContext, SwitchPetContext } from '../context'
import { SkillPhase } from './skill'
import { SwitchPetPhase } from './switch'
import { MarkCleanupPhase } from './MarkCleanupPhase'
import { MarkUpdatePhase } from './MarkUpdatePhase'
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

  protected async executeOperation(): Promise<void> {
    const context = this._context!

    // Execute the turn operation logic (extracted from performTurn)
    // Note: executeTurnOperation is synchronous but we wrap it in async
    this.battle.executionBudget.run(this.battle.currentTurn + 1, () => executeTurnOperation(context, this.battle))
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

  // Process player selections and create phases for queuing
  const scheduled: (UseSkillContext | SwitchPetContext)[] = []

  for (const selection of [battle.playerA.selection, battle.playerB.selection]) {
    const player = battle.getPlayerByID(selection.player)

    switch (selection.type) {
      case 'use-skill': {
        const skill = battle.getSkillByID(selection.skill)
        // Create UseSkillContext for BeforeSort effects
        const useSkillContext = new UseSkillContext(context, player, player.activePet, skill.target, skill)
        battle.applyEffects(useSkillContext, EffectTrigger.BeforeSort)

        scheduled.push(useSkillContext)
        break
      }
      case 'switch-pet': {
        const pet = battle.getPetByID(selection.pet)
        // Create SwitchPetContext
        const switchPetContext = new SwitchPetContext(context, player, pet)

        scheduled.push(switchPetContext)
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
        throw new Error('未知的selection type')
    }
  }

  scheduled.sort(compareActions)

  // Keep the legacy context views aligned with the actual phase schedule.
  // Planned contexts use pop order; applied contexts use dispatch order, including the current attempt.
  context.contexts.push(...[...scheduled].reverse())
  context.contextQueue = [...context.contexts]

  try {
    battle.applyEffects(context, EffectTrigger.TurnStart)

    // Execute all phases in sorted order
    for (const action of scheduled) {
      context.contextQueue.pop()
      battle.phaseManager.run(action instanceof UseSkillContext ? new SkillPhase(action) : new SwitchPetPhase(action))
      battle.phaseManager.run(new MarkCleanupPhase(battle, context))
    }

    // Apply TurnEnd effects before adding rage (correct timing)
    battle.applyEffects(context, EffectTrigger.TurnEnd)
    addTurnRage(context, battle) // Add rage at turn end
    updateTurnMark(context, battle)
    battle.phaseManager.run(new MarkCleanupPhase(battle, context))
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
    changeRage(new RageContext(context, player, 'turn', 'add', player.activePet.stat.ragePerTurn))
  })
}

/**
 * Update turn-based marks using MarkUpdatePhase
 */
function updateTurnMark(context: TurnContext, battle: Battle): void {
  // Collect all marks that need updating
  const allMarks = [
    ...battle.marks, // Battle-level marks (weather, etc.)
    ...battle.playerA.activePet.marks,
    ...battle.playerB.activePet.marks,
  ]

  // Update each mark using MarkUpdatePhase
  allMarks.forEach(mark => {
    if (mark.isActive) {
      battle.phaseManager.run(new MarkUpdatePhase(battle, context, mark))
    }
  })

  // Filter out inactive marks after all updates
  battle.marks = battle.marks.filter(mark => mark.isActive)
  battle.playerA.activePet.marks = battle.playerA.activePet.marks.filter(mark => mark.isActive)
  battle.playerB.activePet.marks = battle.playerB.activePet.marks.filter(mark => mark.isActive)
}

function compareActions(a: UseSkillContext | SwitchPetContext, b: UseSkillContext | SwitchPetContext): number {
  if (a instanceof SwitchPetContext) return b instanceof SwitchPetContext ? 0 : -1
  if (b instanceof SwitchPetContext) return 1
  return b.priority - a.priority || b.pet.actualStat.spe - a.pet.actualStat.spe
}
