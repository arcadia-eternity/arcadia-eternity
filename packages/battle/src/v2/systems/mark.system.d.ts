import { type World, type AttributeSystem } from '@arcadia-eternity/engine';
import type { BaseMarkData, MarkData, MarkConfigData } from '../schemas/mark.schema.js';
export declare const MARK: 'mark';
export declare const BATTLE_OWNER_ID: 'battle';
export declare class MarkSystem {
    private attrSystem;
    constructor(attrSystem: AttributeSystem);
    createFromBase(world: World, baseMark: BaseMarkData, overrides?: {
        duration?: number;
        stack?: number;
        config?: Partial<MarkConfigData>;
        creatorId?: string;
    }): MarkData;
    attach(world: World, markId: string, ownerId: string, ownerType: 'pet' | 'battle'): void;
    detach(world: World, markId: string): void;
    destroy(world: World, markId: string): void;
    addStack(world: World, markId: string, amount: number): number;
    consumeStack(world: World, markId: string, amount: number): number;
    decrementDuration(world: World, markId: string): number;
    setDuration(world: World, markId: string, duration: number): void;
    setStack(world: World, markId: string, stack: number): void;
    setActive(world: World, markId: string, active: boolean): void;
    getStack(world: World, markId: string): number;
    getDuration(world: World, markId: string): number;
    isActive(world: World, markId: string): boolean;
    getTags(world: World, markId: string): string[];
    getConfig(world: World, markId: string): MarkConfigData;
    getMarksOnEntity(world: World, entityId: string): MarkData[];
    findByBaseId(world: World, entityId: string, baseMarkId: string): MarkData | undefined;
    get(world: World, markId: string): MarkData | undefined;
    getOrThrow(world: World, markId: string): MarkData;
    /**
     * Get all shield marks on an entity (marks with isShield=true).
     */
    getShieldMarks(world: World, entityId: string): MarkData[];
    /**
     * Find all marks on an entity that belong to a given mutex group.
     */
    findByMutexGroup(world: World, entityId: string, group: string): MarkData[];
}
//# sourceMappingURL=mark.system.d.ts.map