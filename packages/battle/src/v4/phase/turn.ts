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
  const scheduled: { phase: SkillPhase | SwitchPetPhase; context: UseSkillContext | SwitchPetContext }[] = []

  for (const selection of [battle.playerA.selection, battle.playerB.selection]) {
    const player = battle.getPlayerByID(selection.player)

    switch (selection.type) {
      case 'use-skill': {
        const skill = battle.getSkillByID(selection.skill)
        // Create UseSkillContext for BeforeSort effects
        const useSkillContext = new UseSkillContext(context, player, player.activePet, skill.target, skill)
        battle.applyEffects(useSkillContext, EffectTrigger.BeforeSort)

        // Create SkillPhase with the context
        const skillPhase = new SkillPhase(
          battle,
          player,
          player.activePet,
          skill.target,
          skill,
          context,
          useSkillContext,
        )
        scheduled.push({ phase: skillPhase, context: useSkillContext })
        break
      }
      case 'switch-pet': {
        const pet = battle.getPetByID(selection.pet)
        // Create SwitchPetContext
        const switchPetContext = new SwitchPetContext(context, player, pet)

        // Create SwitchPetPhase with the context
        const switchPhase = new SwitchPetPhase(battle, player, pet, context, switchPetContext)
        scheduled.push({ phase: switchPhase, context: switchPetContext })
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

  // Sort phases directly
  scheduled.sort((a, b) => phaseSort(a.phase, b.phase))

  // Keep the legacy context views aligned with the actual phase schedule.
  // Planned contexts use pop order; applied contexts use dispatch order, including the current attempt.
  context.contexts.push(...scheduled.map(entry => entry.context).reverse())
  context.contextQueue = [...context.contexts]

  try {
    battle.applyEffects(context, EffectTrigger.TurnStart)

    // Execute all phases in sorted order
    for (const { phase } of scheduled) {
      context.contextQueue.pop()
      // Register and execute the phase
      battle.phaseManager.registerPhase(phase)
      battle.phaseManager.executePhase(phase.id)

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
      const markUpdatePhase = new MarkUpdatePhase(battle, context, mark)
      battle.phaseManager.registerPhase(markUpdatePhase)
      battle.phaseManager.executePhase(markUpdatePhase.id)
    }
  })

  // Filter out inactive marks after all updates
  battle.marks = battle.marks.filter(mark => mark.isActive)
  battle.playerA.activePet.marks = battle.playerA.activePet.marks.filter(mark => mark.isActive)
  battle.playerB.activePet.marks = battle.playerB.activePet.marks.filter(mark => mark.isActive)
}

/**
 * Sort phases by priority and speed
 */
function phaseSort(a: SkillPhase | SwitchPetPhase, b: SkillPhase | SwitchPetPhase): number {
  // 获取 Phase 的类型，通过构造函数名称来判断（不依赖context）
  const getPhaseType = (phase: SkillPhase | SwitchPetPhase): string => {
    if (phase instanceof SwitchPetPhase) return 'switch-pet'
    if (phase instanceof SkillPhase) return 'use-skill'
    return 'unknown'
  }

  // 类型优先级：换宠 > 使用技能
  const typeOrder: Record<string, number> = {
    'switch-pet': 0, // 换宠优先级最高
    'use-skill': 1,
    unknown: 999,
  }

  const aType = getPhaseType(a)
  const bType = getPhaseType(b)

  // 类型不同时按优先级排序
  if (aType !== bType) {
    return (typeOrder[aType] ?? 999) - (typeOrder[bType] ?? 999)
  }

  // 同类型时比较优先级
  switch (aType) {
    case 'switch-pet':
      // 换宠之间没有优先级差异，保持原顺序
      return 0

    case 'use-skill': {
      // 对于技能phase，我们使用公共getter来访问属性
      // 因为context在排序时还没有初始化
      const aSkillPhase = a as SkillPhase
      const bSkillPhase = b as SkillPhase

      // 获取技能实例来比较优先级和速度
      const aPet = aSkillPhase.petInstance
      const bPet = bSkillPhase.petInstance

      // 先比较技能优先级（优先级高的先执行，所以是降序）
      if (aSkillPhase.effectivePriority !== bSkillPhase.effectivePriority) {
        return bSkillPhase.effectivePriority - aSkillPhase.effectivePriority
      }

      // 同优先级比较速度（速度快的先执行，所以是降序）
      if (aPet.actualStat.spe !== bPet.actualStat.spe) {
        return bPet.actualStat.spe - aPet.actualStat.spe
      }

      // 速度相同，保持原顺序
      return 0
    }
    default:
      return 0
  }
}
