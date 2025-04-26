// 新增怒气相关配置
export const MAX_RAGE = 100
export const RAGE_PER_TURN = 15
export const RAGE_PER_DAMAGE = 0.5

type Brand<T, B> = T & { readonly __brand: B }

export type entityId = Brand<string, 'entityId'>
export type speciesId = Brand<string, 'speciesId'>
export type petId = Brand<string, 'petId'>
export type baseSkillId = Brand<string, 'baseSkillId'>
export type skillId = Brand<string, 'skillId'>
export type playerId = Brand<string, 'playerId'>
export type baseMarkId = Brand<string, 'baseMarkId'>
export type markId = Brand<string, 'markId'>
export type effectId = Brand<string, 'effectId'>
export type effectStateId = Brand<string, 'effectStateId'>

export type Id = PrototypeId | InstanceId

export type PrototypeId = speciesId | baseMarkId | baseSkillId | effectId

export type InstanceId = petId | skillId | markId

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
  weight = 'weight',
  height = 'height',
}

export enum DamageType {
  Physical = 'Physical',
  Special = 'Special',
  Effect = 'Effect',
}

export type StatOutBattle = Record<StatType, number>

export type StatTypeOnBattle = StatTypeWithoutHp | StatTypeOnlyBattle

export type StatStage = Record<StatTypeWithoutHp, number>

export type StatOnBattle = Record<StatTypeOnBattle, number>

export type StatBuffOnBattle = Record<StatTypeOnBattle, BuffNumber> // [百分比，固定值]

export type BuffNumber = [number, number] // [百分比，固定值]

export enum AttackTargetOpinion {
  self = 'self',
  opponent = 'opponent',
}

export const STAT_STAGE_MULTIPLIER = [0.25, 0.28, 0.33, 0.4, 0.5, 0.66, 1, 1.5, 2, 2.5, 3, 3.5, 4] as const
