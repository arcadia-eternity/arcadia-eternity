import type { EffectDef } from '@arcadia-eternity/engine';
import type { BaseMarkData } from '../schemas/mark.schema.js';
import type { BaseSkillData } from '../schemas/skill.schema.js';
import type { SpeciesData } from '../schemas/species.schema.js';
export declare class V2DataRepository {
    private effects;
    private marks;
    private skills;
    private species;
    registerEffect(id: string, effect: EffectDef): void;
    registerMark(id: string, mark: BaseMarkData): void;
    registerSkill(id: string, skill: BaseSkillData): void;
    registerSpecies(id: string, species: SpeciesData): void;
    getEffect(id: string): EffectDef;
    findEffect(id: string): EffectDef | undefined;
    getMark(id: string): BaseMarkData;
    findMark(id: string): BaseMarkData | undefined;
    getSkill(id: string): BaseSkillData;
    findSkill(id: string): BaseSkillData | undefined;
    getSpecies(id: string): SpeciesData;
    findSpecies(id: string): SpeciesData | undefined;
    allEffects(): IterableIterator<EffectDef>;
    allMarks(): IterableIterator<BaseMarkData>;
    allSkills(): IterableIterator<BaseSkillData>;
    allSpecies(): IterableIterator<SpeciesData>;
    stats(): {
        effects: number;
        marks: number;
        skills: number;
        species: number;
    };
    clear(): void;
}
//# sourceMappingURL=v2-data-repository.d.ts.map