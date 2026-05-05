import { type Static } from '@sinclair/typebox';
export declare const PlayerSchema: import("@sinclair/typebox").TObject<{
    type: import("@sinclair/typebox").TLiteral<"player">;
    id: import("@sinclair/typebox").TString;
    name: import("@sinclair/typebox").TString;
    activePetId: import("@sinclair/typebox").TString;
    petIds: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    fullTeamPetIds: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    battleTeamPetIds: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    currentRage: import("@sinclair/typebox").TNumber;
    maxRage: import("@sinclair/typebox").TNumber;
}>;
export type PlayerData = Static<typeof PlayerSchema>;
//# sourceMappingURL=player.schema.d.ts.map