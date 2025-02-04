import { BattleSystem } from './battleSystem'
import { Player } from './player'
import { AttackTargetOpinion } from './const'
import { Mark } from './mark'
import { Pet } from './pet'
import { Skill } from './skill'

export type Context = {
  type: string
  parent: null | BattleSystem | TurnContext | UseSkillContext | SwitchPetContext | Pet | Player | Mark //指明该上下文是由哪个上下文或者对象产生的
}

export type TurnContext = Context & {
  parent: BattleSystem
}

export type UseSkillContext = Context & {
  type: 'use-skill'
  battleSystem: BattleSystem
  parent: TurnContext
  pet: Pet
  player: Player
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
  parent: TurnContext | Player
  battleSystem: BattleSystem
  player: Player
  target: Pet
}

export type RageContext = Context & {
  type: 'rage-cost'
  battleSystem: BattleSystem
  parent: UseSkillContext | EffectContext
  target: Player
  reason: 'turn' | 'damage' | 'skill' | 'skillHit' | 'switch'
  modifiedType: 'setting' | 'add' | 'reduce'
  value: number | [number, number]
  ignoreRageObtainEfficiency: boolean
}

export type EffectContext = Context & {
  type: 'effect'
  battle: BattleSystem
  parent: UseSkillContext | Mark
  owner: Pet
}
