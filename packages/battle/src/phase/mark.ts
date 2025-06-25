import { BattleMessageType } from '@arcadia-eternity/const'
import { AddMarkContext, StackContext } from '../context'
import type { Battle } from '../battle'
import { Pet } from '../pet'
import { StatLevelMarkInstanceImpl, CreateStatStageMark } from '../mark'
import { RemoveMarkPhase } from './RemoveMarkPhase'

/**
 * Handle StatLevel mark stacking with special level-based logic
 */
export function executeStatLevelMarkStacking(
  existingMark: StatLevelMarkInstanceImpl,
  newMark: StatLevelMarkInstanceImpl,
  context: StackContext,
  battle: Battle,
): void {
  // Calculate new level by adding the levels
  const STAT_STAGE_MULTIPLIER = [0.25, 0.28, 0.33, 0.4, 0.5, 0.66, 1, 1.5, 2, 2.5, 3, 3.5, 4] as const
  const maxLevel = (STAT_STAGE_MULTIPLIER.length - 1) / 2
  const newLevel = Math.max(-maxLevel, Math.min(maxLevel, existingMark.level + newMark.level))

  // If new level is 0, destroy the mark
  if (newLevel === 0) {
    const removePhase = new RemoveMarkPhase(battle, context, existingMark)
    battle.phaseManager.registerPhase(removePhase)
    battle.phaseManager.executePhase(removePhase.id)
    return
  }

  // Check if we need to replace the mark (sign change)
  if (Math.sign(existingMark.level) !== Math.sign(newLevel)) {
    // Sign changed, need to replace with new mark with correct baseId
    replaceStatLevelMark(existingMark, newLevel, context.parent, battle)
  } else {
    // Sign unchanged, just update the level
    existingMark.level = newLevel

    // Emit mark update message
    battle.emitMessage(BattleMessageType.MarkUpdate, {
      target: existingMark.owner instanceof Pet ? existingMark.owner.id : 'battle',
      mark: existingMark.toMessage(),
    })
  }
}

/**
 * Replace a StatLevel mark with a new one that has the correct baseId
 */
function replaceStatLevelMark(
  existingMark: StatLevelMarkInstanceImpl,
  newLevel: number,
  context: AddMarkContext,
  battle: Battle,
): void {
  if (!existingMark.owner) return

  // Create new BaseMark with correct baseId
  const newBaseMark = CreateStatStageMark(existingMark.base.statType, newLevel)

  // Save current mark properties
  const currentDuration = existingMark.duration
  const currentConfig = { ...existingMark.config }

  // Create new mark instance
  const newMarkInstance = newBaseMark.createInstance()

  // Set correct level
  newMarkInstance.level = newLevel

  // Set other properties
  newMarkInstance.duration = currentDuration
  newMarkInstance.config = currentConfig

  // Set owner and emitter
  if (existingMark.emitter) {
    newMarkInstance.setOwner(existingMark.owner, existingMark.emitter)
  }

  // Replace in marks array
  const markIndex = existingMark.owner.marks.indexOf(existingMark)
  if (markIndex !== -1) {
    existingMark.owner.marks[markIndex] = newMarkInstance
  }

  // Clean up existing mark's modifier
  existingMark.detach()

  // Add modifier for new mark by attaching to target
  newMarkInstance.attachTo(existingMark.owner)

  // Set existing mark as inactive
  existingMark.isActive = false

  // Emit mark update message
  battle.emitMessage(BattleMessageType.MarkUpdate, {
    target: existingMark.owner instanceof Pet ? existingMark.owner.id : 'battle',
    mark: newMarkInstance.toMessage(),
  })
}
