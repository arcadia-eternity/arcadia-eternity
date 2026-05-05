export interface BattleState {
    playerAId: string;
    playerBId: string;
    status: 'pending' | 'active' | 'ended';
    currentTurn: number;
    currentPhase?: 'switch' | 'selection' | 'teamSelection' | 'turn';
    victor?: string;
    endReason?: 'surrender' | 'allFainted' | 'timeout';
    selections: Record<string, PlayerSelection>;
    waitingPlayerIds?: string[];
    pendingForcedSwitchPlayerIds: string[];
    pendingFaintSwitchPlayerId?: string;
    lastKillerId?: string;
    allowFaintSwitch: boolean;
}
export interface PlayerSelection {
    type: 'skill' | 'switch' | 'surrender';
    skillIndex?: number;
    targetIndex?: number;
    switchToPetId?: string;
}
export interface BattleStateInitOptions {
    allowFaintSwitch?: boolean;
}
export declare function createBattleState(playerAId: string, playerBId: string, options?: BattleStateInitOptions): BattleState;
//# sourceMappingURL=battle-state.d.ts.map