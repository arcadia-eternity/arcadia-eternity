import { type World, type AttributeSystem } from '@arcadia-eternity/engine';
import type { PlayerData } from '../schemas/player.schema.js';
import type { PetData } from '../schemas/pet.schema.js';
export declare const PLAYER: 'player';
export declare class PlayerSystem {
    private attrSystem;
    constructor(attrSystem: AttributeSystem);
    create(world: World, name: string, petIds: string[], idOverride?: string): PlayerData;
    getRage(world: World, playerId: string): number;
    getMaxRage(world: World, playerId: string): number;
    setRage(world: World, playerId: string, value: number): void;
    addRage(world: World, playerId: string, delta: number): number;
    getActivePet(world: World, playerId: string): PetData;
    setActivePet(world: World, playerId: string, petId: string): void;
    getAlivePets(world: World, playerId: string): PetData[];
    getAvailableSwitchPets(world: World, playerId: string): PetData[];
    applyTeamSelection(world: World, playerId: string, selectedPetIds: string[], starterPetId: string): void;
    get(world: World, playerId: string): PlayerData | undefined;
    getOrThrow(world: World, playerId: string): PlayerData;
}
//# sourceMappingURL=player.system.d.ts.map