import { BattlePhase } from './battleSystem'
import { Player } from './player'
import { StatTypeOnBattle } from './const'

// battleSystem.ts
export enum BattleMessageType {
  // 战斗流程
  BattleStart = 'BATTLE_START',
  RoundStart = 'ROUND_START',
  PhaseChange = 'PHASE_CHANGE',
  BattleEnd = 'BATTLE_END',

  // 精灵相关
  PetSwitch = 'PET_SWITCH',
  PetDefeated = 'PET_DEFEATED',
  PetRevive = 'PET_REVIVE',
  StatChange = 'STAT_CHANGE',

  // 资源变化
  RageChange = 'RAGE_CHANGE',
  HpChange = 'HP_CHANGE',

  // 技能相关
  SkillUse = 'SKILL_USE',
  SkillMiss = 'SKILL_MISS',
  SkillEffect = 'SKILL_EFFECT',

  // 战斗事件
  Damage = 'DAMAGE',
  Heal = 'HEAL',
  Crit = 'CRIT',
  TypeEffectiveness = 'TYPE_EFFECTIVENESS',

  // 状态效果
  StatusAdd = 'STATUS_ADD',
  StatusRemove = 'STATUS_REMOVE',
  StatusTrigger = 'STATUS_TRIGGER',

  // 印记相关
  MarkApply = 'MARK_APPLY',
  MarkTrigger = 'MARK_TRIGGER',
  MarkExpire = 'MARK_EXPIRE',

  // 系统信息
  TurnAction = 'TURN_ACTION',
  ForcedSwitch = 'FORCED_SWITCH',
  KillerSwitch = 'KILLER_SWITCH',
  InvalidAction = 'INVALID_ACTION',
  Error = 'Error',
}

export type BattleMessage =
  | BattleStartMessage
  | RoundStartMessage
  | PhaseChangeMessage
  | BattleEndMessage
  | PetSwitchMessage
  | PetDefeatedMessage
  | PetReviveMessage
  | StatChangeMessage
  | RageChangeMessage
  | HpChangeMessage
  | SkillUseMessage
  | SkillMissMessage
  | SkillEffectMessage
  | DamageMessage
  | HealMessage
  | CritMessage
  | TypeEffectivenessMessage
  | StatusAddMessage
  | StatusRemoveMessage
  | StatusTriggerMessage
  | MarkApplyMessage
  | MarkTriggerMessage
  | MarkExpireMessage
  | TurnActionMessage
  | ForcedSwitchMessage
  | KillerSwitchMessage
  | InvalidActionMessage

// 基础消息结构
interface BaseBattleMessage<T extends BattleMessageType> {
  type: T
  sequenceId?: number
  data: BattleMessageData[T]
}

// 各消息类型数据结构
export interface BattleMessageData {
  [BattleMessageType.BattleStart]: {
    playerA: string
    playerB: string
    pets: {
      playerA: string
      playerB: string
    }
  }
  [BattleMessageType.RoundStart]: {
    round: number
  }
  [BattleMessageType.PhaseChange]: {
    from: BattlePhase
    to: BattlePhase
  }
  [BattleMessageType.BattleEnd]: {
    winner: string
    reason: 'all_pet_fainted' | 'surrender'
  }

  [BattleMessageType.PetSwitch]: {
    player: string
    fromPet: string
    toPet: string
    currentHp: number
  }
  [BattleMessageType.PetDefeated]: {
    pet: string
    killer?: string
  }
  [BattleMessageType.PetRevive]: {
    pet: string
    revivedBy: string
  }
  [BattleMessageType.StatChange]: {
    pet: string
    stat: StatTypeOnBattle
    stage: number // -6到+6
    reason: string
  }

  [BattleMessageType.RageChange]: {
    player: string
    pet: string
    before: number
    after: number
    reason: 'turn' | 'damage' | 'skill' | 'skillHit' | 'switch'
  }
  [BattleMessageType.HpChange]: {
    pet: string
    before: number
    after: number
    maxHp: number
    reason: 'damage' | 'heal' | 'drain' | 'revive'
  }

  [BattleMessageType.SkillUse]: {
    user: string
    target: string
    skill: string
    rageCost: number
  }
  [BattleMessageType.SkillMiss]: {
    user: string
    target: string
    skill: string
    reason: 'accuracy' | 'dodge' | 'immune'
  }
  [BattleMessageType.SkillEffect]: {
    user?: string
    target: string
    effect: string
    description: string
  }

  [BattleMessageType.Damage]: {
    maxHp: number
    currentHp: number
    source: string
    target: string
    damage: number
    basePower: number
    isCrit: boolean
    effectiveness: number
    damageType: 'physical' | 'special' | 'fixed'
  }
  [BattleMessageType.Heal]: {
    target: string
    amount: number
    source: 'skill' | 'item' | 'effect'
    healer?: string
  }
  [BattleMessageType.Crit]: {
    attacker: string
    target: string
  }
  [BattleMessageType.TypeEffectiveness]: {
    attackerType: string
    defenderType: string
    multiplier: number
  }

  [BattleMessageType.StatusAdd]: {
    target: string
    status: string
    source?: string
  }
  [BattleMessageType.StatusRemove]: {
    target: string
    status: string
    reason: 'timeout' | 'clear' | 'replace'
  }
  [BattleMessageType.StatusTrigger]: {
    target: string
    status: string
    effect: string
  }

  [BattleMessageType.MarkApply]: {
    markType: string
    applier: string
    target: string
    duration: number
  }
  [BattleMessageType.MarkTrigger]: {
    markType: string
    trigger: string
    effect: string
  }
  [BattleMessageType.MarkExpire]: {
    markType: string
    target: string
  }

  [BattleMessageType.TurnAction]: {
    player: string
    actionType: 'skill' | 'switch' | 'item' | 'wait'
    actionDetail: string
  }
  [BattleMessageType.ForcedSwitch]: {
    player: Player
    required: boolean
  }
  [BattleMessageType.KillerSwitch]: {
    player: string
    available: boolean
  }
  [BattleMessageType.InvalidAction]: {
    player: string
    action: string
    reason: 'no_rage' | 'cooldown' | 'invalid_target' | 'dead_pet' | 'invalid_action'
  }
  [BattleMessageType.Error]: {
    message: string
  }
}

// 具体消息类型定义
type BattleStartMessage = BaseBattleMessage<BattleMessageType.BattleStart>
type RoundStartMessage = BaseBattleMessage<BattleMessageType.RoundStart>
type PhaseChangeMessage = BaseBattleMessage<BattleMessageType.PhaseChange>
type BattleEndMessage = BaseBattleMessage<BattleMessageType.BattleEnd>
type PetSwitchMessage = BaseBattleMessage<BattleMessageType.PetSwitch>
type PetDefeatedMessage = BaseBattleMessage<BattleMessageType.PetDefeated>
type PetReviveMessage = BaseBattleMessage<BattleMessageType.PetRevive>
type StatChangeMessage = BaseBattleMessage<BattleMessageType.StatChange>
type RageChangeMessage = BaseBattleMessage<BattleMessageType.RageChange>
type HpChangeMessage = BaseBattleMessage<BattleMessageType.HpChange>
type SkillUseMessage = BaseBattleMessage<BattleMessageType.SkillUse>
type SkillMissMessage = BaseBattleMessage<BattleMessageType.SkillMiss>
type SkillEffectMessage = BaseBattleMessage<BattleMessageType.SkillEffect>
type DamageMessage = BaseBattleMessage<BattleMessageType.Damage>
type HealMessage = BaseBattleMessage<BattleMessageType.Heal>
type CritMessage = BaseBattleMessage<BattleMessageType.Crit>
type TypeEffectivenessMessage = BaseBattleMessage<BattleMessageType.TypeEffectiveness>
type StatusAddMessage = BaseBattleMessage<BattleMessageType.StatusAdd>
type StatusRemoveMessage = BaseBattleMessage<BattleMessageType.StatusRemove>
type StatusTriggerMessage = BaseBattleMessage<BattleMessageType.StatusTrigger>
type MarkApplyMessage = BaseBattleMessage<BattleMessageType.MarkApply>
type MarkTriggerMessage = BaseBattleMessage<BattleMessageType.MarkTrigger>
type MarkExpireMessage = BaseBattleMessage<BattleMessageType.MarkExpire>
type TurnActionMessage = BaseBattleMessage<BattleMessageType.TurnAction>
type ForcedSwitchMessage = BaseBattleMessage<BattleMessageType.ForcedSwitch>
type KillerSwitchMessage = BaseBattleMessage<BattleMessageType.KillerSwitch>
type InvalidActionMessage = BaseBattleMessage<BattleMessageType.InvalidAction>
