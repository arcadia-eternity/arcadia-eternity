// battle/src/v2/types/battle-attributes.ts
// Union of all attribute keys and types registered across pet, skill, mark, and player entities.
// Used as the TAttributes generic parameter on AttributeSystem for compile-time type narrowing.

import type { Element, Gender, Nature, Category, AttackTargetOpinion } from '@arcadia-eternity/const'
import type { MarkConfigData } from '../schemas/mark.schema.js'

// ---------------------------------------------------------------------------
// Per-entity attribute maps
// ---------------------------------------------------------------------------

export interface PetAttributes {
  maxHp: number
  atk: number
  def: number
  spa: number
  spd: number
  spe: number
  accuracy: number
  evasion: number
  critRate: number
  ragePerTurn: number
  weight: number
  height: number
  currentHp: number
  isAlive: boolean
  name: string
  speciesId: string
  level: number
  element: Element
  gender: Gender
  nature: Nature
  appeared: boolean
}

export interface SkillAttributes {
  power: number
  accuracy: number
  rage: number
  priority: number
  category: Category
  element: Element
  target: AttackTargetOpinion
  multihit: [number, number] | number
  sureHit: boolean
  sureCrit: boolean
  ignoreShield: boolean
  tags: string[]
  appeared: boolean
}

export interface MarkAttributes {
  stack: number
  duration: number
  isActive: boolean
  tags: string[]
  config: MarkConfigData
}

export interface PlayerAttributes {
  currentRage: number
  maxRage: number
}

export type BattleAttributes = PetAttributes & SkillAttributes & MarkAttributes & PlayerAttributes
