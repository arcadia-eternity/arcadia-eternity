import type { World, EventBus, PhaseManager } from '@arcadia-eternity/engine';
import type { BattleInstance } from './game.js';
import type { SelectionSystem } from './systems/selection.system.js';
import type { TimerSystem } from './systems/timer.system.js';
export declare class BattleOrchestrator {
    private battle;
    private selectionSystem;
    private running;
    private decisionManager;
    constructor(battle: BattleInstance, selectionSystem: SelectionSystem, timerSystem?: TimerSystem);
    get world(): World;
    get pm(): PhaseManager;
    get bus(): EventBus;
    startBattle(options?: {
        resumeFromSnapshot?: boolean;
    }): Promise<void>;
    isBattleEnded(): boolean;
    handleSurrender(playerId: string, reason?: 'surrender' | 'timeout'): void;
    stop(): void;
    private runTeamSelectionIfNeeded;
    private getTeamSelectionConfig;
    private buildTeamInfo;
    private getDefaultSelection;
    private normalizeTeamSelection;
}
//# sourceMappingURL=orchestrator.d.ts.map