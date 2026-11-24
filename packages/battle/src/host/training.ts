import {
  BattleMessageType,
  BattlePhase,
  BattleStatus,
  type petId,
  type playerId,
  type PlayerSelection,
} from '@arcadia-eternity/const'
import type { Battle } from '../engine/battle'
import { AIPlayer } from '../engine/player'

export type TrainingCommand =
  | { type: 'inspect' }
  | { type: 'set-hp'; pet: petId; value: number }
  | { type: 'set-rage'; player: playerId; value: number }
  | { type: 'choose-ai'; key?: string }

function actionKey(action: PlayerSelection) {
  if (action.type === 'use-skill') return action.skill
  if (action.type === 'switch-pet') return action.pet
  return action.type
}

function boundedValue(value: number, max: number) {
  if (!Number.isFinite(value)) throw new Error('Invalid training value')
  return Math.max(0, Math.min(Math.trunc(value), max))
}

export function runTrainingCommand(battle: Battle, command: TrainingCommand) {
  const editable =
    battle.status === BattleStatus.OnBattle &&
    (battle.currentPhase === BattlePhase.SelectionPhase || battle.currentPhase === BattlePhase.SwitchPhase)
  if (command.type !== 'inspect' && !editable) throw new Error('请在回合选择阶段使用训练面板')
  const ai = battle.playerB instanceof AIPlayer ? battle.playerB : undefined

  switch (command.type) {
    case 'set-hp': {
      const pet = battle.getPetByID(command.pet)
      const before = pet.currentHp
      pet.currentHp = boundedValue(command.value, pet.stat.maxHp)
      pet.isAlive = pet.currentHp > 0
      battle.emitMessage(BattleMessageType.HpChange, {
        pet: pet.id,
        before,
        after: pet.currentHp,
        maxHp: pet.stat.maxHp,
        reason: before === 0 && pet.isAlive ? 'revive' : pet.currentHp > before ? 'heal' : 'damage',
      })
      break
    }
    case 'set-rage': {
      const player = battle.getPlayerByID(command.player)
      const before = player.currentRage
      player.currentRage = boundedValue(command.value, player.maxRage)
      if (ai && player === ai && ai.selection) {
        const queued = actionKey(ai.selection)
        const available = ai.getAvailableSelection()
        if (available.length && !available.some(action => actionKey(action) === queued)) {
          battle.setSelection(ai.makeAIDecision())
        }
      }
      battle.emitMessage(BattleMessageType.RageChange, {
        player: player.id,
        pet: player.activePet.id,
        before,
        after: player.currentRage,
        reason: 'effect',
      })
      break
    }
    case 'choose-ai': {
      if (!ai || !ai.getAvailableSelection().length) throw new Error('当前没有可选的 AI 操作')
      const selection =
        command.key === undefined
          ? ai.makeAIDecision()
          : ai.getAvailableSelection().find(action => actionKey(action) === command.key)
      if (!selection || !battle.setSelection(selection)) throw new Error('该 AI 操作当前不可用')
      break
    }
  }

  const selectedKey = ai?.selection && actionKey(ai.selection)
  const choices = (editable && ai ? ai.getAvailableSelection() : []).map(action => ({
    key: actionKey(action),
    type: action.type,
    skillId: action.type === 'use-skill' ? battle.getSkillByID(action.skill).baseId : undefined,
    petName: action.type === 'switch-pet' ? battle.getPetByID(action.pet).name : undefined,
    selected: selectedKey === actionKey(action),
  }))
  return { seed: battle.rngSeed, editable, choices }
}

export type TrainingState = ReturnType<typeof runTrainingCommand>
