import { type Static } from '@sinclair/typebox';
export declare const StatOutBattleSchema: import("@sinclair/typebox").TObject<{
    hp: import("@sinclair/typebox").TNumber;
    atk: import("@sinclair/typebox").TNumber;
    def: import("@sinclair/typebox").TNumber;
    spa: import("@sinclair/typebox").TNumber;
    spd: import("@sinclair/typebox").TNumber;
    spe: import("@sinclair/typebox").TNumber;
}>;
export declare const SpeciesSchema: import("@sinclair/typebox").TObject<{
    type: import("@sinclair/typebox").TLiteral<"species">;
    id: import("@sinclair/typebox").TString;
    num: import("@sinclair/typebox").TNumber;
    assetRef: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    element: import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<string>[]>;
    baseStats: import("@sinclair/typebox").TObject<{
        hp: import("@sinclair/typebox").TNumber;
        atk: import("@sinclair/typebox").TNumber;
        def: import("@sinclair/typebox").TNumber;
        spa: import("@sinclair/typebox").TNumber;
        spd: import("@sinclair/typebox").TNumber;
        spe: import("@sinclair/typebox").TNumber;
    }>;
    genderRatio: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TTuple<[import("@sinclair/typebox").TNumber, import("@sinclair/typebox").TNumber]>, import("@sinclair/typebox").TNull]>;
    heightRange: import("@sinclair/typebox").TTuple<[import("@sinclair/typebox").TNumber, import("@sinclair/typebox").TNumber]>;
    weightRange: import("@sinclair/typebox").TTuple<[import("@sinclair/typebox").TNumber, import("@sinclair/typebox").TNumber]>;
    abilityIds: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    emblemIds: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
}>;
export type SpeciesData = Static<typeof SpeciesSchema>;
//# sourceMappingURL=species.schema.d.ts.map