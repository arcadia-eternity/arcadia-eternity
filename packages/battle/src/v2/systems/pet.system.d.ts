import { type World, type AttributeSystem } from '@arcadia-eternity/engine';
import { type Nature, type StatOnBattle, type StatOutBattle, Gender } from '@arcadia-eternity/const';
import type { PetData } from '../schemas/pet.schema.js';
import type { SpeciesData } from '../schemas/species.schema.js';
export declare const PET: 'pet';
export interface CreatePetOptions {
    name: string;
    speciesId: string;
    level: number;
    evs: StatOutBattle;
    ivs: StatOutBattle;
    nature: Nature;
    baseSkillIds: string[];
    abilityId?: string;
    emblemId?: string;
    weight?: number;
    height?: number;
    gender?: Gender;
    overrideMaxHp?: number;
}
export declare class PetSystem {
    private attrSystem;
    constructor(attrSystem: AttributeSystem);
    create(world: World, species: SpeciesData, options: CreatePetOptions): PetData;
    get(world: World, petId: string): PetData | undefined;
    getOrThrow(world: World, petId: string): PetData;
    getStatValue(world: World, petId: string, stat: string): number;
    getCurrentHp(world: World, petId: string): number;
    setCurrentHp(world: World, petId: string, value: number): void;
    isAlive(world: World, petId: string): boolean;
    getOwner(world: World, petId: string): string;
    getName(world: World, petId: string): string;
    getSpeciesId(world: World, petId: string): string;
    getLevel(world: World, petId: string): number;
    getElement(world: World, petId: string): PetData['element'];
    getGender(world: World, petId: string): PetData['gender'];
    getNature(world: World, petId: string): PetData['nature'];
    isAppeared(world: World, petId: string): boolean;
    setAppeared(world: World, petId: string, appeared: boolean): void;
    recalculateStats(world: World, petId: string, species: SpeciesData): void;
    static calculateBaseStats(pet: PetData, species: SpeciesData): StatOnBattle;
}
//# sourceMappingURL=pet.system.d.ts.map