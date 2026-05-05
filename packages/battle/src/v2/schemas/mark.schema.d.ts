import { type Static } from '@sinclair/typebox';
export declare const MarkConfigSchema: import("@sinclair/typebox").TObject<{
    duration: import("@sinclair/typebox").TNumber;
    persistent: import("@sinclair/typebox").TBoolean;
    maxStacks: import("@sinclair/typebox").TNumber;
    stackable: import("@sinclair/typebox").TBoolean;
    stackStrategy: import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<string>[]>;
    destroyable: import("@sinclair/typebox").TBoolean;
    isShield: import("@sinclair/typebox").TBoolean;
    keepOnSwitchOut: import("@sinclair/typebox").TBoolean;
    transferOnSwitch: import("@sinclair/typebox").TBoolean;
    inheritOnFaint: import("@sinclair/typebox").TBoolean;
    mutexGroup: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
}>;
export declare const BaseMarkSchema: import("@sinclair/typebox").TObject<{
    type: import("@sinclair/typebox").TLiteral<"baseMark">;
    id: import("@sinclair/typebox").TString;
    iconRef: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    config: import("@sinclair/typebox").TObject<{
        duration: import("@sinclair/typebox").TNumber;
        persistent: import("@sinclair/typebox").TBoolean;
        maxStacks: import("@sinclair/typebox").TNumber;
        stackable: import("@sinclair/typebox").TBoolean;
        stackStrategy: import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<string>[]>;
        destroyable: import("@sinclair/typebox").TBoolean;
        isShield: import("@sinclair/typebox").TBoolean;
        keepOnSwitchOut: import("@sinclair/typebox").TBoolean;
        transferOnSwitch: import("@sinclair/typebox").TBoolean;
        inheritOnFaint: import("@sinclair/typebox").TBoolean;
        mutexGroup: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>;
    tags: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    effectIds: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
}>;
export declare const MarkSchema: import("@sinclair/typebox").TObject<{
    type: import("@sinclair/typebox").TLiteral<"mark">;
    id: import("@sinclair/typebox").TString;
    baseMarkId: import("@sinclair/typebox").TString;
    ownerId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    ownerType: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<"battle" | "pet">[]>>;
    stack: import("@sinclair/typebox").TNumber;
    duration: import("@sinclair/typebox").TNumber;
    isActive: import("@sinclair/typebox").TBoolean;
    config: import("@sinclair/typebox").TObject<{
        duration: import("@sinclair/typebox").TNumber;
        persistent: import("@sinclair/typebox").TBoolean;
        maxStacks: import("@sinclair/typebox").TNumber;
        stackable: import("@sinclair/typebox").TBoolean;
        stackStrategy: import("@sinclair/typebox").TUnion<import("@sinclair/typebox").TLiteral<string>[]>;
        destroyable: import("@sinclair/typebox").TBoolean;
        isShield: import("@sinclair/typebox").TBoolean;
        keepOnSwitchOut: import("@sinclair/typebox").TBoolean;
        transferOnSwitch: import("@sinclair/typebox").TBoolean;
        inheritOnFaint: import("@sinclair/typebox").TBoolean;
        mutexGroup: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>;
    tags: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    effectIds: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    creatorId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
}>;
export type MarkConfigData = Static<typeof MarkConfigSchema>;
export type BaseMarkData = Static<typeof BaseMarkSchema>;
export type MarkData = Static<typeof MarkSchema>;
//# sourceMappingURL=mark.schema.d.ts.map