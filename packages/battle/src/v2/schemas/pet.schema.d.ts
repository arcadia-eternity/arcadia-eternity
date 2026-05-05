import { type Static } from '@sinclair/typebox';
export declare const StatOutBattleSchema: import("@sinclair/typebox").TObject<{
    hp: import("@sinclair/typebox").TNumber;
    atk: import("@sinclair/typebox").TNumber;
    def: import("@sinclair/typebox").TNumber;
    spa: import("@sinclair/typebox").TNumber;
    spd: import("@sinclair/typebox").TNumber;
    spe: import("@sinclair/typebox").TNumber;
}>;
export declare const PetSchema: import("@sinclair/typebox").TObject<{
    type: import("@sinclair/typebox").TLiteral<"pet">;
    id: import("@sinclair/typebox").TString;
    speciesId: import("@sinclair/typebox").TString;
    name: import("@sinclair/typebox").TString;
    level: import("@sinclair/typebox").TNumber;
    element: import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<string>[]>;
    gender: import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<string>[]>;
    nature: import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<string>[]>;
    ownerId: import("@sinclair/typebox").TString;
    evs: import("@sinclair/typebox").TObject<{
        hp: import("@sinclair/typebox").TNumber;
        atk: import("@sinclair/typebox").TNumber;
        def: import("@sinclair/typebox").TNumber;
        spa: import("@sinclair/typebox").TNumber;
        spd: import("@sinclair/typebox").TNumber;
        spe: import("@sinclair/typebox").TNumber;
    }>;
    ivs: import("@sinclair/typebox").TObject<{
        hp: import("@sinclair/typebox").TNumber;
        atk: import("@sinclair/typebox").TNumber;
        def: import("@sinclair/typebox").TNumber;
        spa: import("@sinclair/typebox").TNumber;
        spd: import("@sinclair/typebox").TNumber;
        spe: import("@sinclair/typebox").TNumber;
    }>;
    skillIds: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    markIds: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    currentHp: import("@sinclair/typebox").TNumber;
    isAlive: import("@sinclair/typebox").TBoolean;
    appeared: import("@sinclair/typebox").TBoolean;
    lastSkillId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    lastBaseSkillId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    lastSkillUsedTimes: import("@sinclair/typebox").TNumber;
    skillHistorySkillIds: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    skillHistoryBaseIds: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    overrideMaxHp: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
    weight: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
    height: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
    abilityId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    emblemId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
}>;
export type PetData = Static<typeof PetSchema>;
//# sourceMappingURL=pet.schema.d.ts.map