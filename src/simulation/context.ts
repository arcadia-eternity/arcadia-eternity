import { BattleSystem } from './battleSystem'
import { Player } from './player'
import { AttackTargetOpinion } from './const'
import { Mark } from './mark'
import { Pet } from './pet'
import { Skill } from './skill'

export type Context = {
  type: string
  source: null | UseSkillContext | SwitchPetContext | Pet | Player | Mark
}

export type UseSkillContext = Context & {
  type: 'use-skill'
  battleSystem: BattleSystem
  player: Player
  source: Pet
  selectTarget: AttackTargetOpinion
  actualTarget?: Pet
  skill: Skill
  skillPriority: number
  useSkillSuccess: boolean
  power: number
  rageCost: number
  damageModified: [number, number] // 百分比修正, 固定值修正
  damageResult: number
  minThreshold?: number // 最小伤害阈值数值
  maxThreshold?: number // 最大伤害阈值数值
  crit: boolean
  sureHit: boolean
}

export type SwitchPetContext = Context & {
  type: 'switch-pet'
  battleSystem: BattleSystem
  player: Player
  target: Pet
}

export type rageContext = Context & {
  type: 'rage-cost'
  battleSystem: BattleSystem
  source: Skill | Mark
  target: Player
  modifiedType: 'setting' | 'add' | 'reduce'
  value: number | [number, number]
}

export type EffectContext = Context & {
  type: 'effect'
  battle: BattleSystem
  source: UseSkillContext | Mark
  owner: Pet
}
