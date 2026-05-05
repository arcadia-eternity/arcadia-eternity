import type { PhaseHandler, PhaseDef, PhaseResult, World } from '@arcadia-eternity/engine';
import type { EventBus } from '@arcadia-eternity/engine';
export interface SelectionData {
    playerIds: string[];
    selections: Record<string, unknown>;
    timeout?: number;
}
export declare class SelectionHandler implements PhaseHandler<SelectionData> {
    readonly type = "selection";
    initialize(_world: World, phase: PhaseDef): SelectionData;
    execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult>;
    resume(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult>;
}
//# sourceMappingURL=selection.handler.d.ts.map