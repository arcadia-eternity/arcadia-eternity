import type { AttackTargetOpinion, Category, Element, IgnoreStageStrategy } from '@arcadia-eternity/const'
import type { Battle } from './battle.js'
import type { Pet, StageStat } from './pet.js'
import type { Skill } from './skill.js'
import type { Player } from './player.js'
import type { Mark } from './mark.js'

export interface SkillContext {
  kind: 'skill'
  battle: Battle
  player: Player
  pet: Pet
  skill: Skill
  target: Pet
  selectTarget: AttackTargetOpinion
  available: boolean
  power: number
  accuracy: number
  rage: number
  priority: number
  category: Category
  element: Element
  ignoreStageStrategy: IgnoreStageStrategy
  damage?: DamageContext
  hit: boolean
  crit: boolean
  hitCount: number
  currentHit: number
}
export interface DamageContext {
  kind: 'damage'
  battle: Battle
  source: Pet
  target: Pet
  amount: number
  available: boolean
  crit: boolean
  effectiveness: number
  ignoreShield: boolean
  damageType: 'Physical' | 'Special' | 'Effect'
}
export interface RageContext {
  kind: 'rage'
  battle: Battle
  player: Player
  reason: string
  direction: 'add' | 'reduce' | 'setting'
  amount: number
  available: boolean
}
export interface HealContext {
  kind: 'heal'
  battle: Battle
  source: Pet
  target: Pet
  amount: number
  available: boolean
}
export interface StageContext {
  kind: 'stage'
  battle: Battle
  pet: Pet
  stat: StageStat
  amount: number
}
export interface MarkContext {
  kind: 'mark'
  battle: Battle
  mark: Mark
}
export interface SwitchContext {
  kind: 'switch'
  battle: Battle
  player: Player
  outgoing: Pet
  incoming: Pet
}
export interface TurnContext {
  kind: 'turn'
  battle: Battle
}
export type OperationContext =
  | SkillContext
  | DamageContext
  | RageContext
  | HealContext
  | StageContext
  | MarkContext
  | SwitchContext
  | TurnContext
