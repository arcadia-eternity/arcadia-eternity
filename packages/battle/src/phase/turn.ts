import { EffectTrigger, BattleMessageType, RAGE_PER_TURN, BattleStatus } from '@arcadia-eternity/const'
import { InteractivePhase } from './base'
import { TurnContext, RageContext, UseSkillContext, SwitchPetContext } from '../context'
import { SkillPhase } from './skill'
import { SwitchPetPhase } from './switch'
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
    await executeTurnOperation(context, this.battle)
  }
}

/**
 * Extracted turn operation logic from Battle.performTurn
 * This function contains the core turn execution logic
 */
export async function executeTurnOperation(context: TurnContext, battle: Battle): Promise<void> {
  if (!battle.playerA.selection || !battle.playerB.selection) {
    throw new Error('有人还未选择好！')
  }

  // Process player selections and create action phases
  for (const selection of [battle.playerA.selection, battle.playerB.selection]) {
    const player = battle.getPlayerByID(selection.player)

    switch (selection.type) {
      case 'use-skill': {
        const skill = battle.getSkillByID(selection.skill)
        const skillPhase = new SkillPhase(battle, player, player.activePet, skill.target, skill, context)

        // Initialize and queue the skill phase
        await skillPhase.initialize()
        battle.applyEffects(skillPhase.context!, EffectTrigger.BeforeSort)
        context.pushContext(skillPhase.context!)

        // Store phase for execution
        context.contextQueue.push(skillPhase.context!)
        break
      }
      case 'switch-pet': {
        const pet = battle.getPetByID(selection.pet)
        const switchPhase = new SwitchPetPhase(battle, player, pet, context)

        // Initialize and queue the switch phase
        await switchPhase.initialize()
        context.pushContext(switchPhase.context!)

        // Store phase for execution
        context.contextQueue.push(switchPhase.context!)
        break
      }
      case 'do-nothing':
        // Do nothing
        break
      case 'surrender': {
        const player = battle.getPlayerByID(selection.player)
        battle.victor = battle.getOpponent(player)
        battle.status = BattleStatus.Ended
        battle.getVictor(true)
        return
      }
      default:
        throw new Error('未知的context')
    }
  }

  battle.currentTurn++

  battle.emitMessage(BattleMessageType.TurnStart, {
    turn: battle.currentTurn,
  })

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
          _context.origin.performAttack(_context)
          break
        }
        case 'switch-pet': {
          const _context = nowContext as SwitchPetContext
          _context.origin.performSwitchPet(_context)
          break
        }
      }

      battle.cleanupMarks()
    }

    // Apply TurnEnd effects before adding rage (correct timing)
    battle.applyEffects(context, EffectTrigger.TurnEnd)
    addTurnRage(context, battle) // Add rage at turn end
    updateTurnMark(context, battle)
    battle.cleanupMarks()
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
    player.addRage(new RageContext(context, player, 'turn', 'add', RAGE_PER_TURN))
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
