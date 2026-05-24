// battle/src/v2/systems/player.system.ts
// PlayerSystem — class that manages Player entities.

import {
  type WorldSystems,
  type WorldPlugins,
  System,
  createEntity,
  setComponent,
  getComponent,
  getComponentOrThrow,
  generateId,
} from '@arcadia-eternity/engine'
import { MAX_RAGE } from '@arcadia-eternity/const'
import type { PlayerData } from '../schemas/player.schema.js'
import type { PetData } from '../schemas/pet.schema.js'
import type { EntityAttributeDef } from './pet.system.js'
import type { BattleState } from '../types/battle-state.js'
import type { BattleWorld } from '../types/battle-world.js'
import type { PetAndPlayerAttributes, PlayerAttributeSystem } from '../types/battle-attributes.js'

export const PLAYER = 'player' as const
const PET = 'pet' as const

// ---------------------------------------------------------------------------
// Attribute declarations — single source of truth for extractor registry
// ---------------------------------------------------------------------------

export const playerAttributes: EntityAttributeDef[] = [
  { key: 'currentRage', valueType: 'number', modifiable: true },
  { key: 'maxRage', valueType: 'number', modifiable: true },
]

// ---------------------------------------------------------------------------
// PlayerSystem
// ---------------------------------------------------------------------------

export class PlayerSystem extends System<BattleState, WorldSystems, WorldPlugins, PetAndPlayerAttributes> {
  constructor(attrSystem: PlayerAttributeSystem) {
    super(attrSystem)
  }

  // -----------------------------------------------------------------------
  // Creation
  // -----------------------------------------------------------------------

  create(world: BattleWorld, name: string, petIds: string[], idOverride?: string): PlayerData {
    const id = idOverride ?? generateId('player')

    const player: PlayerData = {
      type: 'player' as const,
      id,
      name,
      activePetId: petIds[0] ?? '',
      petIds: [...petIds],
      fullTeamPetIds: [...petIds],
      battleTeamPetIds: [...petIds],
      currentRage: 20,
      maxRage: MAX_RAGE,
    }

    createEntity(world, id, [PLAYER])
    setComponent(world, id, PLAYER, player)

    this.attrSystem.registerAttribute(world, id, 'currentRage', 20)
    this.attrSystem.registerAttribute(world, id, 'maxRage', MAX_RAGE)

    for (const petId of petIds) {
      const pet = getComponentOrThrow(world, petId, PET) as PetData
      pet.ownerId = id
    }

    return player
  }

  // -----------------------------------------------------------------------
  // Rage operations
  // -----------------------------------------------------------------------

  getRage(world: BattleWorld, playerId: string): number {
    return this.attrSystem.getValue(world, playerId, 'currentRage')
  }

  getMaxRage(world: BattleWorld, playerId: string): number {
    return this.attrSystem.getValue(world, playerId, 'maxRage')
  }

  setRage(world: BattleWorld, playerId: string, value: number): void {
    const maxRage = this.getMaxRage(world, playerId)
    const clamped = Math.max(0, Math.min(value, maxRage))
    this.attrSystem.setBaseValue(world, playerId, 'currentRage', clamped)
  }

  addRage(world: BattleWorld, playerId: string, delta: number): number {
    const current = this.getRage(world, playerId)
    const maxRage = this.getMaxRage(world, playerId)
    const newValue = Math.max(0, Math.min(current + delta, maxRage))
    const actualDelta = newValue - current
    this.setRage(world, playerId, newValue)
    return actualDelta
  }

  // -----------------------------------------------------------------------
  // Active pet
  // -----------------------------------------------------------------------

  getActivePet(world: BattleWorld, playerId: string): PetData {
    const player = getComponentOrThrow(world, playerId, PLAYER) as PlayerData
    return getComponentOrThrow(world, player.activePetId, PET) as PetData
  }

  setActivePet(world: BattleWorld, playerId: string, petId: string): void {
    ;(getComponentOrThrow(world, playerId, PLAYER) as PlayerData).activePetId = petId
  }

  // -----------------------------------------------------------------------
  // Team queries
  // -----------------------------------------------------------------------

  getAlivePets(world: BattleWorld, playerId: string): PetData[] {
    const player = getComponentOrThrow(world, playerId, PLAYER) as PlayerData
    return player.battleTeamPetIds
      .map(id => getComponentOrThrow(world, id, PET) as PetData)
      .filter(pet => this.attrSystem.getValue(world, pet.id, 'isAlive') ?? false)
  }

  getAvailableSwitchPets(world: BattleWorld, playerId: string): PetData[] {
    const player = getComponentOrThrow(world, playerId, PLAYER) as PlayerData
    return player.battleTeamPetIds
      .filter(id => id !== player.activePetId)
      .map(id => getComponentOrThrow(world, id, PET) as PetData)
      .filter(pet => this.attrSystem.getValue(world, pet.id, 'isAlive') ?? false)
  }

  applyTeamSelection(world: BattleWorld, playerId: string, selectedPetIds: string[], starterPetId: string): void {
    const player = getComponentOrThrow(world, playerId, PLAYER) as PlayerData
    player.battleTeamPetIds = [...selectedPetIds]
    player.activePetId = starterPetId
  }

  get(world: BattleWorld, playerId: string): PlayerData | undefined {
    return getComponent(world, playerId, PLAYER) as PlayerData | undefined
  }

  getOrThrow(world: BattleWorld, playerId: string): PlayerData {
    return getComponentOrThrow(world, playerId, PLAYER) as PlayerData
  }
}
