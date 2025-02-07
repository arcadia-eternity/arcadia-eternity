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

export interface OwnedEntity {
  owner: BattleSystem | Player | Pet | Mark | Skill | null

  setOwner(owner: BattleSystem | Player | Pet | Mark | Skill): void
}
