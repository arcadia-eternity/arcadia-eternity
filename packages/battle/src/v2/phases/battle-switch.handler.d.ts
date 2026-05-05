import type { PhaseHandler, PhaseDef, PhaseResult, World, PhaseManager } from '@arcadia-eternity/engine';
import type { EventBus } from '@arcadia-eternity/engine';
import type { PlayerSystem } from '../systems/player.system.js';
import type { PetSystem } from '../systems/pet.system.js';
import type { SelectionSystem } from '../systems/selection.system.js';
import type { DecisionManager } from '../decision/manager.js';
export interface BattleSwitchPhaseData {
    selectionSystem: SelectionSystem;
    decisionManager: DecisionManager;
}
export declare class BattleSwitchHandler implements PhaseHandler<BattleSwitchPhaseData> {
    private playerSystem;
    private petSystem;
    private phaseManager;
    readonly type = "battleSwitch";
    constructor(playerSystem: PlayerSystem, petSystem: PetSystem, phaseManager: PhaseManager);
    initialize(_world: World, phase: PhaseDef): BattleSwitchPhaseData;
    execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult>;
}
//# sourceMappingURL=battle-switch.handler.d.ts.map