// battle/src/v2/systems/pet.system.ts
// PetSystem — class that manages Pet entities.

import {
  type World,
  type AttributeSystem,
  createEntity,
  setComponent,
  getComponent,
  getComponentOrThrow,
  generateId,
} from '@arcadia-eternity/engine'
import {
  NatureMap,
  type Nature,
  type StatOnBattle,
  type StatOutBattle,
  RAGE_PER_TURN,
  Gender,
} from '@arcadia-eternity/const'
import type { PetData } from '../schemas/pet.schema.js'
import type { SpeciesData } from '../schemas/species.schema.js'

export const PET = 'pet' as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreatePetOptions {
  name: string
  speciesId: string
  level: number
  evs: StatOutBattle
  ivs: StatOutBattle
  nature: Nature
  baseSkillIds: string[]
  abilityId?: string
  emblemId?: string
  weight?: number
  height?: number
  gender?: Gender
  overrideMaxHp?: number
}

// ---------------------------------------------------------------------------
// PetSystem
// ---------------------------------------------------------------------------

export class PetSystem {
  constructor(private attrSystem: AttributeSystem) {}

  // -----------------------------------------------------------------------
  // Creation
  // -----------------------------------------------------------------------

  create(world: World, species: SpeciesData, options: CreatePetOptions): PetData {
    const id = generateId('pet')

    const pet: PetData = {
      type: 'pet' as const,
      id,
      speciesId: species.id,
      name: options.name,
      level: options.level,
      element: species.element,
      gender: (options.gender ?? resolveDefaultGender(species)) as PetData['gender'],
      nature: options.nature as PetData['nature'],
      ownerId: '',
      evs: options.evs,
      ivs: options.ivs,
      skillIds: [],
      markIds: [],
      currentHp: 0,
      isAlive: true,
      appeared: false,
      lastSkillUsedTimes: 0,
      skillHistorySkillIds: [],
      skillHistoryBaseIds: [],
      overrideMaxHp: options.overrideMaxHp,
      weight: options.weight,
      height: options.height,
      abilityId: options.abilityId,
      emblemId: options.emblemId,
    }

    createEntity(world, id, [PET])
    setComponent(world, id, PET, pet)

    const baseStats = PetSystem.calculateBaseStats(pet, species)
    for (const [key, value] of Object.entries(baseStats)) {
      this.attrSystem.registerAttribute(world, id, key, value)
    }
    this.attrSystem.registerAttribute(world, id, 'name', pet.name)
    this.attrSystem.registerAttribute(world, id, 'speciesId', pet.speciesId)
    this.attrSystem.registerAttribute(world, id, 'level', pet.level)
    this.attrSystem.registerAttribute(world, id, 'element', pet.element)
    this.attrSystem.registerAttribute(world, id, 'gender', pet.gender)
    this.attrSystem.registerAttribute(world, id, 'nature', pet.nature)
    this.attrSystem.registerAttribute(world, id, 'appeared', false)
    this.attrSystem.registerAttribute(world, id, 'currentHp', baseStats.maxHp)
    this.attrSystem.registerAttribute(world, id, 'isAlive', true)

    return pet
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  get(world: World, petId: string): PetData | undefined {
    return getComponent<PetData>(world, petId, PET)
  }

  getOrThrow(world: World, petId: string): PetData {
    return getComponentOrThrow<PetData>(world, petId, PET)
  }

  getStatValue(world: World, petId: string, stat: string): number {
    const value = this.attrSystem.getValue(world, petId, stat)
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }

  getCurrentHp(world: World, petId: string): number {
    return (this.attrSystem.getBaseValue(world, petId, 'currentHp') as number) ?? 0
  }

  setCurrentHp(world: World, petId: string, value: number): void {
    const clamped = Math.max(0, value)
    this.attrSystem.setBaseValue(world, petId, 'currentHp', clamped)
    this.attrSystem.setBaseValue(world, petId, 'isAlive', clamped > 0)
  }

  isAlive(world: World, petId: string): boolean {
    return (this.attrSystem.getValue(world, petId, 'isAlive') as boolean | undefined) ?? false
  }

  getOwner(world: World, petId: string): string {
    return this.getOrThrow(world, petId).ownerId
  }

  getName(world: World, petId: string): string {
    return this.attrSystem.getValue(world, petId, 'name') as string
  }

  getSpeciesId(world: World, petId: string): string {
    return this.attrSystem.getValue(world, petId, 'speciesId') as string
  }

  getLevel(world: World, petId: string): number {
    return this.attrSystem.getValue(world, petId, 'level') as number
  }

  getElement(world: World, petId: string): PetData['element'] {
    return this.attrSystem.getValue(world, petId, 'element') as PetData['element']
  }

  getGender(world: World, petId: string): PetData['gender'] {
    return this.attrSystem.getValue(world, petId, 'gender') as PetData['gender']
  }

  getNature(world: World, petId: string): PetData['nature'] {
    return this.attrSystem.getValue(world, petId, 'nature') as PetData['nature']
  }

  isAppeared(world: World, petId: string): boolean {
    return this.attrSystem.getValue(world, petId, 'appeared') as boolean
  }

  setAppeared(world: World, petId: string, appeared: boolean): void {
    this.attrSystem.setBaseValue(world, petId, 'appeared', appeared)
  }

  recalculateStats(world: World, petId: string, species: SpeciesData): void {
    const pet = this.getOrThrow(world, petId)
    const newStats = PetSystem.calculateBaseStats(pet, species)
    for (const [key, value] of Object.entries(newStats)) {
      this.attrSystem.setBaseValue(world, petId, key, value)
    }
  }

  // -----------------------------------------------------------------------
  // Stat calculation (static — no instance state needed)
  // -----------------------------------------------------------------------

  static calculateBaseStats(pet: PetData, species: SpeciesData): StatOnBattle {
    const nature = pet.nature as Nature
    const natureMultipliers = NatureMap[nature]
    const level = pet.level

    const atk = calcStatWithoutHp(species.baseStats.atk, level, pet.ivs.atk, pet.evs.atk, natureMultipliers.atk)
    const def = calcStatWithoutHp(species.baseStats.def, level, pet.ivs.def, pet.evs.def, natureMultipliers.def)
    const spa = calcStatWithoutHp(species.baseStats.spa, level, pet.ivs.spa, pet.evs.spa, natureMultipliers.spa)
    const spd = calcStatWithoutHp(species.baseStats.spd, level, pet.ivs.spd, pet.evs.spd, natureMultipliers.spd)
    const spe = calcStatWithoutHp(species.baseStats.spe, level, pet.ivs.spe, pet.evs.spe, natureMultipliers.spe)
    const maxHp = calcMaxHp(species.baseStats.hp, level, pet.ivs.hp, pet.evs.hp, pet.overrideMaxHp)

    return {
      maxHp,
      atk,
      def,
      spa,
      spd,
      spe,
      accuracy: 100,
      critRate: 7,
      evasion: 0,
      ragePerTurn: RAGE_PER_TURN,
      weight: pet.weight ?? species.weightRange[1],
      height: pet.height ?? species.heightRange[1],
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function calcStatWithoutHp(baseStat: number, level: number, iv: number, ev: number, natureMultiplier: number): number {
  return Math.floor(((2 * baseStat + iv + Math.floor(ev / 4)) * level) / 100 + 5) * natureMultiplier
}

function calcMaxHp(baseStat: number, level: number, iv: number, ev: number, overrideMaxHp?: number): number {
  if (overrideMaxHp !== undefined && Number.isFinite(overrideMaxHp)) return overrideMaxHp
  return Math.floor(((2 * baseStat + iv + Math.floor(ev / 4)) * level) / 100) + level + 10
}

function resolveDefaultGender(species: SpeciesData): Gender {
  if (!species.genderRatio) return Gender.NoGender
  return species.genderRatio[0] !== 0 ? Gender.Female : Gender.Male
}
