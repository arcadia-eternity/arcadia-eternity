import { BattlePhase } from './battlePhase'
import { BattleStatus } from './battleStatus'
import { Category } from './category'
import {
  AttackTargetOpinion,
  type baseMarkId,
  type baseSkillId,
  type effectId,
  type markId,
  type petId,
  type playerId,
  type skillId,
  type speciesId,
  type StatOnBattle,
  type StatTypeOnBattle,
} from './const'
import { Element } from './element'

export interface SkillMessage {
  id: skillId
  baseId: baseSkillId
  category: Category
  element: Element
  power: number
  rage: number
  accuracy: number
  priority: number
  target: AttackTargetOpinion
  multihit: [number, number] | number
  sureHit: boolean
  tag: string[]
}

export interface PetMessage {
  name: string
  id: petId
  speciesID: speciesId
  element: Element
  level: number
  currentHp: number
  maxHp: number
  skills?: SkillMessage[] //skillmessage
  stats?: StatOnBattle
  marks: MarkMessage[] //markmessage
}

export interface MarkMessage {
  id: markId
  baseId: baseMarkId
  stack: number
  duration: number
  isActive: boolean
}

export interface PlayerMessage {
  name: string
  id: playerId
  rage: number
  activePet: PetMessage
  team?: PetMessage[]
  teamAlives: number
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
  TurnStart = 'TURN_START',
  BattleEnd = 'BATTLE_END',

  // 精灵相关
  PetSwitch = 'PET_SWITCH',
  PetDefeated = 'PET_DEFEATED',
  PetRevive = 'PET_REVIVE', //UnUsed
  StatChange = 'STAT_CHANGE', //UnUsed

  // 资源变化
  RageChange = 'RAGE_CHANGE',
  HpChange = 'HP_CHANGE', //UnUsed

  // 技能相关
  SkillUse = 'SKILL_USE',
  SkillMiss = 'SKILL_MISS',

  // 战斗事件
  Damage = 'DAMAGE',
  Heal = 'HEAL',

  // 印记相关
  MarkApply = 'MARK_APPLY', //UnUsed
  MarkDestory = 'MARK_DESTORY', //UnUsed
  MarkExpire = 'MARK_EXPIRE', //UnUsed
  MarkUpdate = 'MARK_UPDATE', //UnUsed

  EffectApply = 'EFFECT_APPLY',

  // 需要等待回应的信息
  TurnAction = 'TURN_ACTION',
  ForcedSwitch = 'FORCED_SWITCH',
  FaintSwitch = 'FAINT_SWITCH',

  InvalidAction = 'INVALID_ACTION', //UnUsed
  Info = 'INFO',
  Error = 'ERROR',
}

export type BattleMessage =
  | BattleStateMessage
  | BattleStartMessage
  | RoundStartMessage
  | BattleEndMessage
  | PetSwitchMessage
  | PetDefeatedMessage
  | PetReviveMessage
  | StatChangeMessage
  | RageChangeMessage
  | HpChangeMessage
  | SkillUseMessage
  | SkillMissMessage
  | DamageMessage
  | HealMessage
  | MarkApplyMessage
  | MarkTriggerMessage
  | MarkExpireMessage
  | MarkUpdateMessage
  | EffectApplyMessage
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
  [BattleMessageType.TurnStart]: {
    round: number
  }
  [BattleMessageType.BattleEnd]: {
    winner: playerId | null
    reason: 'all_pet_fainted' | 'surrender'
  }

  [BattleMessageType.PetSwitch]: {
    player: playerId
    fromPet: petId
    toPet: petId
    currentHp: number
  }
  [BattleMessageType.PetDefeated]: {
    pet: petId
    killer?: petId
  }
  [BattleMessageType.PetRevive]: {
    pet: petId
    revivedBy: petId
  }
  [BattleMessageType.StatChange]: {
    pet: petId
    stat: StatTypeOnBattle
    stage: number // -6到+6
    reason: string
  }

  [BattleMessageType.RageChange]: {
    player: playerId
    pet: petId
    before: number
    after: number
    reason: 'turn' | 'damage' | 'skill' | 'skillHit' | 'switch' | 'effect'
  }
  [BattleMessageType.HpChange]: {
    pet: petId
    before: number
    after: number
    maxHp: number
    reason: 'damage' | 'heal' | 'drain' | 'revive'
  }

  [BattleMessageType.SkillUse]: {
    user: petId
    target: AttackTargetOpinion
    skill: skillId
    rageCost: number
  }
  [BattleMessageType.SkillMiss]: {
    user: petId
    target: petId
    skill: skillId
    reason: 'accuracy' | 'dodge' | 'immune'
  }
  [BattleMessageType.Damage]: {
    maxHp: number
    currentHp: number
    source: petId | markId | skillId
    target: petId
    damage: number
    isCrit: boolean
    effectiveness: number
    damageType: 'physical' | 'special' | 'effect'
  }
  [BattleMessageType.Heal]: {
    target: petId
    amount: number
    source: 'skill' | 'item' | 'effect'
    healer?: string
  }
  [BattleMessageType.MarkApply]: {
    markType: baseMarkId
    applier: petId
    target: petId
    markId: markId
    duration: number
  }
  [BattleMessageType.MarkDestory]: {
    mark: markId
    target: petId
  }
  [BattleMessageType.MarkExpire]: {
    mark: markId
    target: petId
  }
  [BattleMessageType.MarkUpdate]: {
    mark: MarkMessage
  }
  [BattleMessageType.EffectApply]: {
    source: markId | skillId
    effect: effectId
  }
  [BattleMessageType.TurnAction]: {
    player: playerId[]
  }
  [BattleMessageType.ForcedSwitch]: {
    player: playerId[]
  }
  [BattleMessageType.FaintSwitch]: {
    player: playerId
  }
  [BattleMessageType.InvalidAction]: {
    player: playerId
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
type RoundStartMessage = BaseBattleMessage<BattleMessageType.TurnStart>
type BattleEndMessage = BaseBattleMessage<BattleMessageType.BattleEnd>
type PetSwitchMessage = BaseBattleMessage<BattleMessageType.PetSwitch>
type PetDefeatedMessage = BaseBattleMessage<BattleMessageType.PetDefeated>
type PetReviveMessage = BaseBattleMessage<BattleMessageType.PetRevive>
type StatChangeMessage = BaseBattleMessage<BattleMessageType.StatChange>
type RageChangeMessage = BaseBattleMessage<BattleMessageType.RageChange>
type HpChangeMessage = BaseBattleMessage<BattleMessageType.HpChange>
type SkillUseMessage = BaseBattleMessage<BattleMessageType.SkillUse>
type SkillMissMessage = BaseBattleMessage<BattleMessageType.SkillMiss>
type DamageMessage = BaseBattleMessage<BattleMessageType.Damage>
type HealMessage = BaseBattleMessage<BattleMessageType.Heal>
type MarkApplyMessage = BaseBattleMessage<BattleMessageType.MarkApply>
type MarkTriggerMessage = BaseBattleMessage<BattleMessageType.EffectApply>
type MarkExpireMessage = BaseBattleMessage<BattleMessageType.MarkExpire>
type MarkUpdateMessage = BaseBattleMessage<BattleMessageType.MarkUpdate>
type EffectApplyMessage = BaseBattleMessage<BattleMessageType.EffectApply>
type TurnActionMessage = BaseBattleMessage<BattleMessageType.TurnAction>
type ForcedSwitchMessage = BaseBattleMessage<BattleMessageType.ForcedSwitch>
type FaintSwitchMessage = BaseBattleMessage<BattleMessageType.FaintSwitch>
type InvalidActionMessage = BaseBattleMessage<BattleMessageType.InvalidAction>
type InfoMessage = BaseBattleMessage<BattleMessageType.Info>
type ErrorMessage = BaseBattleMessage<BattleMessageType.Error>
