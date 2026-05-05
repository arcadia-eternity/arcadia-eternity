import type { World } from '@arcadia-eternity/engine';
import type { PlayerSelection } from '@arcadia-eternity/const';
import type { PlayerSystem } from './player.system.js';
import type { SkillSystem } from './skill.system.js';
import type { PetSystem } from './pet.system.js';
export declare class SelectionSystem {
    private playerSystem;
    private petSystem;
    private skillSystem;
    private waitResolve;
    private waitReject;
    private abortController;
    constructor(playerSystem: PlayerSystem, petSystem: PetSystem, skillSystem: SkillSystem);
    setSelection(world: World, pid: string, selection: PlayerSelection): boolean;
    clearSelections(world: World): void;
    getSelection(world: World, pid: string): PlayerSelection | null;
    private getSelections;
    getAvailableSelections(world: World, pid: string): PlayerSelection[];
    waitForAllSelections(world: World, playerIds: string[]): Promise<Record<string, PlayerSelection>>;
    cancelWaiting(): void;
    private checkAndResolve;
}
//# sourceMappingURL=selection.system.d.ts.map