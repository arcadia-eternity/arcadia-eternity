// battle/src/v2/types/battle-attributes.ts
// Union of all attribute keys and types registered across pet, skill, mark, and player entities.
// Used as the TAttributes generic parameter on AttributeSystem for compile-time type narrowing.

import type { Element, Gender, Nature, Category, AttackTargetOpinion } from '@arcadia-eternity/const'
import type { AttributeSystem, WorldSystems, WorldPlugins, World } from '@arcadia-eternity/engine'
import type { MarkConfigData } from '../schemas/mark.schema.js'
import type { BattleState } from './battle-state.js'

// ---------------------------------------------------------------------------
// Convenience World type matching the per-entity AttributeSystem aliases
// ---------------------------------------------------------------------------

export type SystemWorld = World<BattleState, WorldSystems, WorldPlugins>

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

// Convenience union for systems that span entity types
export type PetAndPlayerAttributes = PetAttributes & PlayerAttributes

// ---------------------------------------------------------------------------
// Per-entity typed AttributeSystem aliases.
// TSystems uses WorldSystems (not BattleSystems) to avoid circular deps.
// ---------------------------------------------------------------------------

export type PetAttributeSystem = AttributeSystem<BattleState, WorldSystems, WorldPlugins, PetAttributes>
export type SkillAttributeSystem = AttributeSystem<BattleState, WorldSystems, WorldPlugins, SkillAttributes>
export type MarkAttributeSystem = AttributeSystem<BattleState, WorldSystems, WorldPlugins, MarkAttributes>
export type PlayerAttributeSystem = AttributeSystem<BattleState, WorldSystems, WorldPlugins, PetAndPlayerAttributes>
export type BattleAttributeSystem = AttributeSystem<BattleState, WorldSystems, WorldPlugins, BattleAttributes>
