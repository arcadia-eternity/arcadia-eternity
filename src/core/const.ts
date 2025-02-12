import { BattleSystem } from './battleSystem'
import { Mark } from './mark'
import { Pet } from './pet'
import { Player } from './player'
import { Skill } from './skill'

// 新增怒气相关配置
export const MAX_RAGE = 100
export const RAGE_PER_TURN = 15
export const RAGE_PER_DAMAGE = 0.5

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

//Pet,Skill,Mark,Effect
export interface Prototype {
  id: string
}

export interface Entity {
  type: string
}

export interface OwnedEntity {
  owner: BattleSystem | Player | Pet | Mark | Skill | null

  setOwner(owner: BattleSystem | Player | Pet | Mark | Skill): void
}

// 宝可梦能力等级修正表
export const STAT_STAGE_MULTIPLIER = [0.25, 0.28, 0.33, 0.4, 0.5, 0.66, 1, 1.5, 2, 2.5, 3, 3.5, 4] as const
