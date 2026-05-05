import { type World, type AttributeSystem } from '@arcadia-eternity/engine';
import type { BaseSkillData, SkillData } from '../schemas/skill.schema.js';
import type { UseSkillContextData } from '../schemas/context.schema.js';
export declare const SKILL: 'skill';
export declare class SkillSystem {
    private attrSystem;
    constructor(attrSystem: AttributeSystem);
    createFromBase(world: World, baseSkill: BaseSkillData, ownerId?: string): SkillData;
    get(world: World, skillId: string): SkillData | undefined;
    getOrThrow(world: World, skillId: string): SkillData;
    getPower(world: World, skillId: string): number;
    getAccuracy(world: World, skillId: string): number;
    getRage(world: World, skillId: string): number;
    getPriority(world: World, skillId: string): number;
    getCategory(world: World, skillId: string): SkillData['category'];
    getElement(world: World, skillId: string): SkillData['element'];
    getTarget(world: World, skillId: string): SkillData['target'];
    getMultihit(world: World, skillId: string): SkillData['multihit'];
    getSureHit(world: World, skillId: string): boolean;
    getSureCrit(world: World, skillId: string): boolean;
    getIgnoreShield(world: World, skillId: string): boolean;
    getIgnoreOpponentStageStrategy(world: World, skillId: string): BaseSkillData['ignoreOpponentStageStrategy'];
    getTags(world: World, skillId: string): string[];
    isAppeared(world: World, skillId: string): boolean;
    setAppeared(world: World, skillId: string, appeared: boolean): void;
    setOwner(world: World, skillId: string, ownerId: string): void;
    applyToUseSkillContext(world: World, skillId: string, context: UseSkillContextData, options?: {
        getOpponentActivePetId?: (originPlayerId: string) => string | undefined;
    }): void;
}
//# sourceMappingURL=skill.system.d.ts.map