import { BattlePhase, BattleStatus } from './battle'
import { AttackTargetOpinion, StatOnBattle, StatTypeOnBattle } from './const'
import { Element } from './element'
import { Category } from './skill'

export interface SkillMessage {
  id: string
  name: string
  category: Category
  element: Element
  power: number
  rage: number
  accuracy: number
  priority: number
  target: AttackTargetOpinion
  multihit: [number, number] | number
  sureHit: boolean
}

export interface PetMessage {
  name: string
  uid: string
  speciesID: string
  element: Element
  currentHp: number
  maxHp: number
  skills: SkillMessage[] //skillmessage
  stats: StatOnBattle
  marks: MarkMessage[] //markmessage
}

export interface MarkMessage {
  name: string
  id: string
  stack: number
  duration: number
  isActive: boolean
}

export interface PlayerMessage {
  name: string
  uid: string
  activePet: PetMessage
  team: PetMessage[]
}

export interface BattleState {
  status: BattleStatus
  currentPhase: BattlePhase
  currentTurn: number
  marks: MarkMessage[]

  players: PlayerMessage[]
}

// battleSystem.ts
export enum BattleMessageType {
  BattleState = 'BATTLE_STATE',

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

  // 印记相关
  MarkApply = 'MARK_APPLY',
  MarkTrigger = 'MARK_TRIGGER',
  MarkExpire = 'MARK_EXPIRE',

  // 需要等待回应的信息
  TurnAction = 'TURN_ACTION',
  ForcedSwitch = 'FORCED_SWITCH',
  FaintSwitch = 'FAINT_SWITCH',

  InvalidAction = 'INVALID_ACTION',
  Info = 'INFO',
  Error = 'ERROR',
}

export type BattleMessage =
  | BattleStateMessage
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
  | MarkApplyMessage
  | MarkTriggerMessage
  | MarkExpireMessage
  | TurnActionMessage
  | ForcedSwitchMessage
  | FaintSwitchMessage
  | InvalidActionMessage
  | InfoMessage
  | ErrorMessage

// 基础消息结构
interface BaseBattleMessage<T extends BattleMessageType> {
  type: T
  sequenceId?: number
  data: BattleMessageData[T]
}

// 各消息类型数据结构
export interface BattleMessageData {
  [BattleMessageType.BattleState]: BattleState

  [BattleMessageType.BattleStart]: {
    playerA: PlayerMessage
    playerB: PlayerMessage
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
    reason: 'turn' | 'damage' | 'skill' | 'skillHit' | 'switch' | 'effect'
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
    isCrit: boolean
    effectiveness: number
    damageType: 'physical' | 'special' | 'effect'
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

  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  [BattleMessageType.TurnAction]: {} //TODO: 我寻思应该不需要特别的信息来提示该选择了
  [BattleMessageType.ForcedSwitch]: {
    player: string[]
  }
  [BattleMessageType.FaintSwitch]: {
    player: string
  }
  [BattleMessageType.InvalidAction]: {
    player: string
    action: string
    reason: 'no_rage' | 'cooldown' | 'invalid_target' | 'dead_pet' | 'invalid_action'
  }
  [BattleMessageType.Info]: {
    message: string
  }
  [BattleMessageType.Error]: {
    message: string
  }
}

// 具体消息类型定义
type BattleStateMessage = BaseBattleMessage<BattleMessageType.BattleState>
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
type MarkApplyMessage = BaseBattleMessage<BattleMessageType.MarkApply>
type MarkTriggerMessage = BaseBattleMessage<BattleMessageType.MarkTrigger>
type MarkExpireMessage = BaseBattleMessage<BattleMessageType.MarkExpire>
type TurnActionMessage = BaseBattleMessage<BattleMessageType.TurnAction>
type ForcedSwitchMessage = BaseBattleMessage<BattleMessageType.ForcedSwitch>
type FaintSwitchMessage = BaseBattleMessage<BattleMessageType.FaintSwitch>
type InvalidActionMessage = BaseBattleMessage<BattleMessageType.InvalidAction>
type InfoMessage = BaseBattleMessage<BattleMessageType.Info>
type ErrorMessage = BaseBattleMessage<BattleMessageType.Error>
