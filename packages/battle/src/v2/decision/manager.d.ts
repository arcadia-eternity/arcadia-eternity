import { type PlayerSelection } from '@arcadia-eternity/const';
import type { BattleInstance } from '../game.js';
import type { SelectionSystem } from '../systems/selection.system.js';
import type { TimerSystem } from '../systems/timer.system.js';
import type { DecisionPhase } from './types.js';
interface CollectDecisionOptions {
    turnTimeLimitOverrideSec?: number;
}
export declare class DecisionManager {
    private battle;
    private selectionSystem;
    private timerSystem?;
    private activeAbortController;
    private readonly timeoutSurrenderPlayers;
    constructor(battle: BattleInstance, selectionSystem: SelectionSystem, timerSystem?: TimerSystem | undefined);
    collectDecisions(playerIds: string[], phase: DecisionPhase, options?: CollectDecisionOptions): Promise<Record<string, PlayerSelection>>;
    cancelPendingDecisions(): void;
    consumeTimeoutSurrender(playerId: string): boolean;
    private decideForPlayer;
    private handleTimeout;
    private pickFallbackSelection;
    private pickTurnTimeoutSelection;
    private pickSurrenderSelection;
    private describeSelection;
    private resolveProvider;
    private getProviderSpec;
    private getDecisionConfig;
    private getPlayerSlot;
}
export {};
//# sourceMappingURL=manager.d.ts.map