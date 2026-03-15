import type { BattleMessage, BattleState, TimerConfig, PlayerTimerState } from '@arcadia-eternity/const';
import type { PlayerSchemaType, PlayerSelectionSchemaType, PetSchemaType } from '@arcadia-eternity/schema';
import type { PackLock } from '@arcadia-eternity/schema/src/pack.js';
import type { AssetLock } from '@arcadia-eternity/schema/src/assets.js';
export type { PetSchemaType, PlayerSchemaType, PlayerSelectionSchemaType };
export type SuccessResponse<T = undefined> = {
    status: 'SUCCESS';
    data: T;
};
export type ErrorResponse = {
    status: 'ERROR';
    code: string;
    details?: string;
};
export type AckResponse<T = unknown> = (response: SuccessResponse<T> | ErrorResponse) => void;
export type ServerState = {
    onlinePlayers: number;
    matchmakingQueue: number;
    rooms: number;
    playersInRooms: number;
};
export interface ServerToClientEvents {
    ping: () => void;
    updateState: (state: ServerState) => void;
    battleEvent: (message: BattleMessage) => void;
    battleEventBatch: (messages: BattleMessage[]) => void;
    timerEvent: (event: {
        type: string;
        data: any;
    }) => void;
    timerSnapshot: (data: {
        snapshots: any[];
    }) => void;
    timerEventBatch: (events: any[]) => void;
    roomClosed: (message: {
        roomId: string;
    }) => void;
    matchSuccess: (response: SuccessResponse<{
        roomId: string;
        opponent: {
            id: string;
            name: string;
        };
    }>) => void;
    matchmakingError: (error: ErrorResponse) => void;
    opponentDisconnected: (data: {
        disconnectedPlayerId: string;
        graceTimeRemaining: number;
    }) => void;
    opponentReconnected: (data: {
        reconnectedPlayerId: string;
    }) => void;
    battleReconnect: (data: {
        roomId: string;
        shouldRedirect: boolean;
        battleState: string;
        fullBattleState?: BattleState;
    }) => void;
    reconnectTest: (data: {
        message: string;
        timestamp: number;
    }) => void;
    privateRoomEvent: (event: PrivateRoomEvent) => void;
    privateRoomPeerSignal: (event: PrivateRoomPeerSignalEvent) => void;
}
export interface ClientToServerEvents {
    pong: () => void;
    getServerState: (ack: AckResponse<ServerState>) => void;
    joinMatchmaking: (data: PlayerSchemaType | {
        playerSchema: PlayerSchemaType;
        ruleSetId?: string;
    }, // 新格式：包含规则集信息
    callback: AckResponse<{
        status: 'QUEUED';
    }>) => void;
    cancelMatchmaking: (ack: AckResponse<{
        status: 'CANCELED';
    }>) => void;
    ready: (ack: AckResponse<{
        status: 'READY';
    }>) => void;
    submitPlayerSelection: (selection: PlayerSelectionSchemaType, callback: AckResponse<{
        status: 'ACTION_ACCEPTED';
    }>) => void;
    getState: (ack: AckResponse<BattleState>) => void;
    getAvailableSelection: (ack: AckResponse<PlayerSelectionSchemaType[]>) => void;
    reportAnimationEnd: (data: {
        animationId: string;
        actualDuration: number;
    }) => void;
    getTimerConfig: (ack: AckResponse<TimerConfig>) => void;
    getPlayerTimerState: (data: {
        playerId: string;
    }, ack: AckResponse<PlayerTimerState | null>) => void;
    getAllPlayerTimerStates: (ack: AckResponse<PlayerTimerState[]>) => void;
    isTimerEnabled: (ack: AckResponse<boolean>) => void;
    startAnimation: (data: {
        source: string;
        expectedDuration: number;
        ownerId: string;
    }, ack: AckResponse<string>) => void;
    endAnimation: (data: {
        animationId: string;
        actualDuration?: number;
    }) => void;
    createPrivateRoom: (data: CreatePrivateRoomRequest, ack: AckResponse<{
        roomCode: string;
    }>) => void;
    joinPrivateRoom: (data: JoinPrivateRoomRequest, ack: AckResponse<{
        status: 'JOINED';
    }>) => void;
    joinPrivateRoomAsSpectator: (data: JoinPrivateRoomSpectatorRequest, ack: AckResponse<{
        status: 'JOINED';
    }>) => void;
    leavePrivateRoom: (ack: AckResponse<{
        status: 'LEFT';
    }>) => void;
    togglePrivateRoomReady: (data: TogglePrivateRoomReadyRequest, ack: AckResponse<{
        status: 'READY_TOGGLED';
    }>) => void;
    startPrivateRoomBattle: (data: StartPrivateRoomBattleRequest, ack: AckResponse<PrivateRoomBattleStartInfo>) => void;
    sendPrivateRoomPeerSignal: (data: SendPrivateRoomPeerSignalRequest, ack: AckResponse<{
        status: 'FORWARDED';
    }>) => void;
    switchToSpectator: (data: {}, ack: AckResponse<{
        status: 'SWITCHED';
    }>) => void;
    switchToPlayer: (data: {
        team: PetSchemaType[];
    }, ack: AckResponse<{
        status: 'SWITCHED';
    }>) => void;
    getPrivateRoomInfo: (data: {
        roomCode: string;
    }, ack: AckResponse<PrivateRoomInfo>) => void;
    updatePrivateRoomRuleSet: (data: UpdatePrivateRoomRuleSetRequest, ack: AckResponse<{
        status: 'UPDATED';
    }>) => void;
    updatePrivateRoomConfig: (data: UpdatePrivateRoomConfigRequest, ack: AckResponse<{
        status: 'UPDATED';
    }>) => void;
    transferPrivateRoomHost: (data: TransferPrivateRoomHostRequest, ack: AckResponse<{
        status: 'TRANSFERRED';
    }>) => void;
    kickPlayerFromPrivateRoom: (data: KickPlayerFromPrivateRoomRequest, ack: AckResponse<{
        status: 'KICKED';
    }>) => void;
    getCurrentPrivateRoom: (ack: AckResponse<PrivateRoomInfo | null>) => void;
    joinSpectateBattle: (data: {
        battleRoomId: string;
    }, ack: AckResponse<{
        status: 'SPECTATING';
    }>) => void;
    leaveSpectateBattle: (data: {}, ack: AckResponse<{
        status: 'LEFT_SPECTATE';
    }>) => void;
}
export interface CreatePrivateRoomRequest {
    config: {
        ruleSetId?: string;
        isPrivate?: boolean;
        password?: string;
        battleMode?: 'p2p' | 'server';
        requiredPackLock?: PackLock;
        requiredAssetLock?: AssetLock;
    };
}
export interface JoinPrivateRoomRequest {
    roomCode: string;
    password?: string;
    clientPackLock?: PackLock;
    clientAssetLock?: AssetLock;
}
export interface JoinPrivateRoomSpectatorRequest {
    roomCode: string;
    clientPackLock?: PackLock;
    clientAssetLock?: AssetLock;
}
export interface TogglePrivateRoomReadyRequest {
    team?: PetSchemaType[];
}
export interface UpdatePrivateRoomRuleSetRequest {
    ruleSetId: string;
}
export interface UpdatePrivateRoomConfigRequest {
    ruleSetId?: string;
    isPrivate?: boolean;
    password?: string;
    battleMode?: 'p2p' | 'server';
    requiredPackLock?: PackLock;
    requiredAssetLock?: AssetLock;
}
export interface StartPrivateRoomBattleRequest {
    hostTeam: PetSchemaType[];
}
export interface PrivateRoomBattleHostInfo {
    playerId: string;
    sessionId: string;
}
export interface PrivateRoomBattleStartInfo {
    battleMode: 'p2p' | 'server';
    battleRoomId?: string;
    battleHost: PrivateRoomBattleHostInfo;
}
export interface PrivateRoomPeerSignalPayload {
    transport: 'webrtc' | 'webtransport';
    kind: 'offer' | 'answer' | 'ice-candidate' | 'ready' | 'custom';
    payload: unknown;
}
export interface SendPrivateRoomPeerSignalRequest {
    targetPlayerId: string;
    targetSessionId?: string;
    signal: PrivateRoomPeerSignalPayload;
}
export interface PrivateRoomPeerSignalEvent {
    roomCode: string;
    from: PrivateRoomBattleHostInfo;
    to: PrivateRoomBattleHostInfo;
    signal: PrivateRoomPeerSignalPayload;
    timestamp: number;
}
export interface TransferPrivateRoomHostRequest {
    targetPlayerId: string;
}
export interface KickPlayerFromPrivateRoomRequest {
    targetPlayerId: string;
}
export interface PrivateRoomPlayer {
    playerId: string;
    playerName: string;
    sessionId: string;
    team?: PetSchemaType[];
    isReady: boolean;
    joinedAt: number;
}
export interface PrivateRoomSpectator {
    playerId: string;
    playerName: string;
    sessionId: string;
    joinedAt: number;
}
export interface PrivateRoomInfo {
    id: string;
    config: {
        roomCode: string;
        hostPlayerId: string;
        ruleSetId: string;
        maxPlayers: number;
        isPrivate: boolean;
        password?: string;
        battleMode: 'p2p' | 'server';
        requiredPackLock?: PackLock;
        requiredAssetLock?: AssetLock;
    };
    players: PrivateRoomPlayer[];
    spectators: PrivateRoomSpectator[];
    status: 'waiting' | 'ready' | 'started' | 'finished' | 'ended';
    createdAt: number;
    lastActivity: number;
    battleRoomId?: string;
    battleHost?: PrivateRoomBattleHostInfo;
    lastBattleResult?: {
        winner: string | null;
        reason: string;
        endedAt: number;
        battleRoomId: string;
    };
}
export type PrivateRoomEvent = {
    type: 'playerJoined';
    data: PrivateRoomPlayer;
} | {
    type: 'playerLeft';
    data: {
        playerId: string;
    };
} | {
    type: 'playerKicked';
    data: {
        playerId: string;
        kickedBy: string;
    };
} | {
    type: 'playerReady';
    data: {
        playerId: string;
        isReady: boolean;
    };
} | {
    type: 'spectatorJoined';
    data: PrivateRoomSpectator;
} | {
    type: 'spectatorLeft';
    data: {
        playerId: string;
    };
} | {
    type: 'playerSwitchedToSpectator';
    data: {
        playerId: string;
    };
} | {
    type: 'spectatorSwitchedToPlayer';
    data: {
        playerId: string;
    };
} | {
    type: 'roomUpdate';
    data: PrivateRoomInfo;
} | {
    type: 'battleStarted';
    data: PrivateRoomBattleStartInfo;
} | {
    type: 'battleFinished';
    data: {
        battleResult: {
            winner: string | null;
            reason: string;
            endedAt: number;
            battleRoomId: string;
        };
    };
} | {
    type: 'ruleSetChanged';
    data: {
        ruleSetId: string;
        changedBy: string;
    };
} | {
    type: 'hostTransferred';
    data: {
        oldHostId: string;
        newHostId: string;
        transferredBy: string;
    };
} | {
    type: 'roomClosed';
    data: {
        reason: string;
    };
} | {
    type: 'roomConfigChanged';
    data: {
        oldConfig: PrivateRoomInfo['config'];
        newConfig: PrivateRoomInfo['config'];
        changedBy: string;
    };
};
//# sourceMappingURL=protocol.d.ts.map