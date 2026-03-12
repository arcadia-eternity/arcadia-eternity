// battle/src/v2/systems/player.system.ts
// PlayerSystem — class that manages Player entities.

import {
  type World,
  type AttributeSystem,
  createEntity,
  setComponent,
  getComponent,
  getComponentOrThrow,
  generateId,
} from '@arcadia-eternity/engine'
import { MAX_RAGE } from '@arcadia-eternity/const'
import type { PlayerData } from '../schemas/player.schema.js'
import type { PetData } from '../schemas/pet.schema.js'

export const PLAYER = 'player' as const
const PET = 'pet' as const

// ---------------------------------------------------------------------------
// PlayerSystem
// ---------------------------------------------------------------------------

export class PlayerSystem {
  constructor(private attrSystem: AttributeSystem) {}

  // -----------------------------------------------------------------------
  // Creation
  // -----------------------------------------------------------------------

  create(world: World, name: string, petIds: string[], idOverride?: string): PlayerData {
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
      const pet = getComponentOrThrow<PetData>(world, petId, PET)
      pet.ownerId = id
    }

    return player
  }

  // -----------------------------------------------------------------------
  // Rage operations
  // -----------------------------------------------------------------------

  getRage(world: World, playerId: string): number {
    return this.attrSystem.getValue(world, playerId, 'currentRage') as number
  }

  getMaxRage(world: World, playerId: string): number {
    return this.attrSystem.getValue(world, playerId, 'maxRage') as number
  }

  setRage(world: World, playerId: string, value: number): void {
    const maxRage = this.getMaxRage(world, playerId)
    const clamped = Math.max(0, Math.min(value, maxRage))
    this.attrSystem.setBaseValue(world, playerId, 'currentRage', clamped)
  }

  addRage(world: World, playerId: string, delta: number): number {
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

  getActivePet(world: World, playerId: string): PetData {
    const player = getComponentOrThrow<PlayerData>(world, playerId, PLAYER)
    return getComponentOrThrow<PetData>(world, player.activePetId, PET)
  }

  setActivePet(world: World, playerId: string, petId: string): void {
    getComponentOrThrow<PlayerData>(world, playerId, PLAYER).activePetId = petId
  }

  // -----------------------------------------------------------------------
  // Team queries
  // -----------------------------------------------------------------------

  getAlivePets(world: World, playerId: string): PetData[] {
    const player = getComponentOrThrow<PlayerData>(world, playerId, PLAYER)
    return player.battleTeamPetIds
      .map(id => getComponentOrThrow<PetData>(world, id, PET))
      .filter(pet => (this.attrSystem.getValue(world, pet.id, 'isAlive') as boolean | undefined) ?? false)
  }

  getAvailableSwitchPets(world: World, playerId: string): PetData[] {
    const player = getComponentOrThrow<PlayerData>(world, playerId, PLAYER)
    return player.battleTeamPetIds
      .filter(id => id !== player.activePetId)
      .map(id => getComponentOrThrow<PetData>(world, id, PET))
      .filter(pet => (this.attrSystem.getValue(world, pet.id, 'isAlive') as boolean | undefined) ?? false)
  }

  applyTeamSelection(world: World, playerId: string, selectedPetIds: string[], starterPetId: string): void {
    const player = getComponentOrThrow<PlayerData>(world, playerId, PLAYER)
    player.battleTeamPetIds = [...selectedPetIds]
    player.activePetId = starterPetId
  }

  get(world: World, playerId: string): PlayerData | undefined {
    return getComponent<PlayerData>(world, playerId, PLAYER)
  }

  getOrThrow(world: World, playerId: string): PlayerData {
    return getComponentOrThrow<PlayerData>(world, playerId, PLAYER)
  }
}
