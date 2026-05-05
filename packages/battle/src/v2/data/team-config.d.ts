import { type Static } from '@sinclair/typebox';
export declare const StatOutBattleSchema: import("@sinclair/typebox").TObject<{
    hp: import("@sinclair/typebox").TNumber;
    atk: import("@sinclair/typebox").TNumber;
    def: import("@sinclair/typebox").TNumber;
    spa: import("@sinclair/typebox").TNumber;
    spd: import("@sinclair/typebox").TNumber;
    spe: import("@sinclair/typebox").TNumber;
}>;
export declare const PetConfigSchema: import("@sinclair/typebox").TObject<{
    name: import("@sinclair/typebox").TString;
    species: import("@sinclair/typebox").TString;
    level: import("@sinclair/typebox").TInteger;
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
    nature: import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<string>[]>;
    skills: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    ability: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    emblem: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    gender: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<string>[]>>;
    weight: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
    height: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
    maxHp: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
}>;
export declare const TeamConfigSchema: import("@sinclair/typebox").TObject<{
    id: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    name: import("@sinclair/typebox").TString;
    team: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        name: import("@sinclair/typebox").TString;
        species: import("@sinclair/typebox").TString;
        level: import("@sinclair/typebox").TInteger;
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
        nature: import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<string>[]>;
        skills: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
        ability: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        emblem: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        gender: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<string>[]>>;
        weight: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
        height: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
        maxHp: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
    }>>;
}>;
export type PetConfig = Static<typeof PetConfigSchema>;
export type TeamConfig = Static<typeof TeamConfigSchema>;
//# sourceMappingURL=team-config.d.ts.map