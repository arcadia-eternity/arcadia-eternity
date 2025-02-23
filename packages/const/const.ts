// 新增怒气相关配置
export const MAX_RAGE = 100
export const RAGE_PER_TURN = 15
export const RAGE_PER_DAMAGE = 0.5

export type entityId = string

export type speciesId = string
export type petId = string

export type baseSkillId = string
export type skillId = string

export type playerId = string

export type baseMarkId = string
export type markId = string

export type effectId = string

export type Id = speciesId | petId | baseMarkId | skillId | baseMarkId | markId | effectId

export enum StatType {
  atk = 'atk',
  def = 'def',
  spa = 'spa',
  spd = 'spd',
  spe = 'spe',
  hp = 'hp',
}

export enum StatTypeWithoutHp {
  atk = 'atk',
  def = 'def',
  spa = 'spa',
  spd = 'spd',
  spe = 'spe',
}

export enum StatTypeOnlyBattle {
  accuracy = 'accuracy',
  evasion = 'evasion',
  critRate = 'critRate',
  ragePerTurn = 'ragePerTurn',
}

export enum DamageType {
  physical = 'physical',
  special = 'special',
  effect = 'effect',
}

export type StatOutBattle = Record<StatType, number>

export type StatTypeOnBattle = StatTypeWithoutHp | StatTypeOnlyBattle

export type StatOnBattle = Record<StatTypeOnBattle, number>

export type StatBuffOnBattle = Record<StatTypeOnBattle, BuffNumber> // [百分比，固定值]

export type BuffNumber = [number, number] // [百分比，固定值]

export enum AttackTargetOpinion {
  self = 'self',
  opponent = 'opponent',
}

// 宝可梦能力等级修正表
export const STAT_STAGE_MULTIPLIER = [0.25, 0.28, 0.33, 0.4, 0.5, 0.66, 1, 1.5, 2, 2.5, 3, 3.5, 4] as const
