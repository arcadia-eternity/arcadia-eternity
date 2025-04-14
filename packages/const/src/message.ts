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
  isUnknown: boolean
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
  isUnknown: boolean
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
  TurnEnd = 'TURN_END',
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
  SkillUseFail = 'SKILL_USE_FAIL',
  SkillMiss = 'SKILL_MISS',
  SkillUseEnd = 'SKILL_USE_END',

  // 战斗事件
  Damage = 'DAMAGE',
  DamageFail = 'DAMAGE_FAIL',
  Heal = 'HEAL',
  HealFail = 'HEAL_FAIL',

  // 印记相关
  MarkApply = 'MARK_APPLY',
  MarkDestory = 'MARK_DESTORY',
  MarkExpire = 'MARK_EXPIRE',
  MarkUpdate = 'MARK_UPDATE', //UnUsed

  EffectApply = 'EFFECT_APPLY',
  EffectApplyFail = 'EFFECT_APPLY_FAIL', //UnUsed

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
  | TurnStartMessage
  | TurnEndMessage
  | BattleEndMessage
  | PetSwitchMessage
  | PetDefeatedMessage
  | PetReviveMessage
  | StatChangeMessage
  | RageChangeMessage
  | HpChangeMessage
  | SkillUseMessage
  | SkillUseFailMessage
  | SkillMissMessage
  | SkillUseEndMessage
  | DamageMessage
  | DamageFailMessage
  | HealMessage
  | HealFailMessage
  | MarkApplyMessage
  | MarkExpireMessage
  | MarkUpdateMessage
  | MarkDestoryMessage
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
    turn: number
  }
  [BattleMessageType.TurnEnd]: {
    turn: number
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
    baseSkill: baseSkillId
    rage: number
  }
  [BattleMessageType.SkillUseFail]: {
    user: petId
    skill: skillId
    reason: 'no_rage' | 'invalid_target' | 'faint' | 'disabled'
  }
  [BattleMessageType.SkillMiss]: {
    user: petId
    target: petId
    skill: skillId
    reason: 'accuracy' | 'dodge' | 'immune'
  }
  [BattleMessageType.SkillUseEnd]: { user: petId }
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
  [BattleMessageType.DamageFail]: {
    source: petId | markId | skillId
    target: petId
    reason: 'disabled'
  }
  [BattleMessageType.Heal]: {
    target: petId
    amount: number
    source: 'item' | 'effect'
    healer?: string
  }
  [BattleMessageType.HealFail]: {
    target: petId
    reason: 'disabled'
  }
  [BattleMessageType.MarkApply]: {
    baseMarkId: baseMarkId
    target: petId | 'battle'
    mark: MarkMessage
  }
  [BattleMessageType.MarkDestory]: {
    mark: markId
    target: petId | 'battle'
  }
  [BattleMessageType.MarkExpire]: {
    mark: markId
    target: petId | 'battle'
  }
  [BattleMessageType.MarkUpdate]: {
    mark: MarkMessage
    target: petId | 'battle'
  }
  [BattleMessageType.EffectApply]: {
    source: markId | skillId
    effect: effectId
  }
  [BattleMessageType.EffectApplyFail]: {
    source: markId | skillId
    effect: effectId
    reason: 'disabled'
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
    reason: 'no_rage' | 'invalid_target' | 'dead_pet' | 'invalid_action'
  }
  [BattleMessageType.Info]: {
    message: string
  }
  [BattleMessageType.Error]: {
    message: string
  }
}

// 具体消息类型定义
export type BattleStateMessage = BaseBattleMessage<BattleMessageType.BattleState>
export type BattleStartMessage = BaseBattleMessage<BattleMessageType.BattleStart>
export type TurnStartMessage = BaseBattleMessage<BattleMessageType.TurnStart>
export type TurnEndMessage = BaseBattleMessage<BattleMessageType.TurnEnd>
export type BattleEndMessage = BaseBattleMessage<BattleMessageType.BattleEnd>
export type PetSwitchMessage = BaseBattleMessage<BattleMessageType.PetSwitch>
export type PetDefeatedMessage = BaseBattleMessage<BattleMessageType.PetDefeated>
export type PetReviveMessage = BaseBattleMessage<BattleMessageType.PetRevive>
export type StatChangeMessage = BaseBattleMessage<BattleMessageType.StatChange>
export type RageChangeMessage = BaseBattleMessage<BattleMessageType.RageChange>
export type HpChangeMessage = BaseBattleMessage<BattleMessageType.HpChange>
export type SkillUseMessage = BaseBattleMessage<BattleMessageType.SkillUse>
export type SkillUseFailMessage = BaseBattleMessage<BattleMessageType.SkillUseFail>
export type SkillMissMessage = BaseBattleMessage<BattleMessageType.SkillMiss>
export type SkillUseEndMessage = BaseBattleMessage<BattleMessageType.SkillUseEnd>
export type DamageMessage = BaseBattleMessage<BattleMessageType.Damage>
export type DamageFailMessage = BaseBattleMessage<BattleMessageType.DamageFail>
export type HealMessage = BaseBattleMessage<BattleMessageType.Heal>
export type HealFailMessage = BaseBattleMessage<BattleMessageType.HealFail>
export type MarkApplyMessage = BaseBattleMessage<BattleMessageType.MarkApply>
export type MarkDestoryMessage = BaseBattleMessage<BattleMessageType.MarkDestory>
export type MarkExpireMessage = BaseBattleMessage<BattleMessageType.MarkExpire>
export type MarkUpdateMessage = BaseBattleMessage<BattleMessageType.MarkUpdate>
export type EffectApplyMessage = BaseBattleMessage<BattleMessageType.EffectApply>
export type TurnActionMessage = BaseBattleMessage<BattleMessageType.TurnAction>
export type ForcedSwitchMessage = BaseBattleMessage<BattleMessageType.ForcedSwitch>
export type FaintSwitchMessage = BaseBattleMessage<BattleMessageType.FaintSwitch>
export type InvalidActionMessage = BaseBattleMessage<BattleMessageType.InvalidAction>
export type InfoMessage = BaseBattleMessage<BattleMessageType.Info>
export type ErrorMessage = BaseBattleMessage<BattleMessageType.Error>
