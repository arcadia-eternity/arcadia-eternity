import type { World, EventBus } from '@arcadia-eternity/engine';
import { type BattleMessage, type playerId } from '@arcadia-eternity/const';
import { type StateSerializerSystems } from './state-serializer.js';
export interface MessageViewOptions {
    viewerId?: playerId;
    showHidden?: boolean;
    showAll?: boolean;
}
export declare class MessageBridge {
    private world;
    private bus;
    private systems;
    private defaultShowHidden;
    private subscribers;
    private unsubscribers;
    private diffPatcher;
    private sequenceId;
    private battleId;
    private phaseTransactions;
    constructor(world: World, bus: EventBus, systems: StateSerializerSystems, defaultShowHidden?: boolean, battleId?: string);
    subscribe(callback: (msg: BattleMessage) => void, options?: MessageViewOptions): () => void;
    setWorld(world: World): void;
    cleanup(): void;
    private emitMessage;
    beginPhaseTransaction(phaseId: string): void;
    commitPhaseTransaction(phaseId: string): void;
    rollbackPhaseTransaction(phaseId: string): void;
    private flushBufferedMessages;
    private dispatchMessage;
    private getStateByOptions;
    private on;
    private toMarkMessage;
    private setupListeners;
}
//# sourceMappingURL=message-bridge.d.ts.map