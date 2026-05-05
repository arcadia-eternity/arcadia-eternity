import type { Socket } from 'socket.io'
import type { AckResponse } from '@arcadia-eternity/protocol'
import type { RoomState, MatchmakingEntry, ServiceInstance } from '../../../cluster/types'
import type { BattleMessage, BattleState, PlayerTimerState, TimerConfig } from '@arcadia-eternity/const'
import type { IBattleSystem } from '@arcadia-eternity/interface'
import type { PlayerSelectionSchemaType } from '@arcadia-eternity/schema'
import type { LocalBattleRoomData } from '../runtime/battleRuntimeHost'
import type { DisconnectedPlayerInfo } from './clusterBattleService'

// 资源加载管理器接口
export interface IResourceLoadingManager {
  isReady(): boolean
  getProgress(): {
    status: string
    error?: string
    gameDataLoaded: boolean
    scriptsLoaded: boolean
    validationCompleted: boolean
  }
}

// 匹配服务依赖接口
export interface IMatchmakingDependencies {
  resourceLoadingManager: IResourceLoadingManager
}

// 战斗服务依赖接口
export type IBattleDependencies = Record<string, never>

// 匹配服务回调接口
export interface MatchmakingCallbacks {
  createLocalBattle: (roomState: RoomState, player1Data: unknown, player2Data: unknown) => Promise<IBattleSystem>
  sendToPlayerSession: (playerId: string, sessionId: string, event: string, data: unknown) => Promise<boolean>
  getPlayerName: (playerId: string) => Promise<string>
  createSessionRoomMappings: (roomState: RoomState) => Promise<void>
  verifyInstanceReachability: (instance: ServiceInstance) => Promise<boolean>
  createClusterBattleRoom: (
    player1Entry: MatchmakingEntry,
    player2Entry: MatchmakingEntry,
    spectators?: { playerId: string; sessionId: string }[],
  ) => Promise<string | null>
  broadcastServerStateUpdate?: () => void
}

// 战斗服务回调接口
export interface BattleCallbacks {
  sendToPlayerSession: (playerId: string, sessionId: string, event: string, data: unknown) => Promise<boolean>
  addToBatch: (playerId: string, sessionId: string, message: BattleMessage) => Promise<void>
  cleanupSessionRoomMappings: (roomState: RoomState) => Promise<void>
  forwardPlayerAction: (instanceId: string, action: string, playerId: string, data: unknown) => Promise<unknown>
  createSessionRoomMappings: (roomState: RoomState) => Promise<void>
  handlePrivateRoomBattleFinished?: (
    battleRoomId: string,
    battleResult: { winner: string | null; reason: string },
  ) => Promise<void>
  joinPlayerToRoom: (playerId: string, roomId: string) => Promise<void>
}

// 匹配服务接口
export interface IMatchmakingService {
  handleJoinMatchmaking(socket: Socket, rawData: unknown, ack?: AckResponse<{ status: 'QUEUED' }>): Promise<void>
  handleCancelMatchmaking(socket: Socket, ack?: AckResponse<{ status: 'CANCELED' }>): Promise<void>
  handleClusterMatchmakingJoin(entry: MatchmakingEntry): Promise<void>
}

// 战斗服务接口
export interface IBattleService {
  createLocalBattle(roomState: RoomState, player1Data: unknown, player2Data: unknown): Promise<IBattleSystem>
  createClusterBattleRoom(
    player1Entry: MatchmakingEntry,
    player2Entry: MatchmakingEntry,
    spectators?: { playerId: string; sessionId: string }[],
  ): Promise<string | null>
  getLocalBattle(roomId: string): IBattleSystem | undefined
  isRoomInCurrentInstance(roomState: RoomState): boolean
  getAllLocalRooms(): Map<string, LocalBattleRoomData>
  getLocalRoom(roomId: string): LocalBattleRoomData | undefined
  addDisconnectedPlayer(
    playerId: string,
    sessionId: string,
    roomId: string,
    graceTimer?: ReturnType<typeof setTimeout>,
  ): void
  getDisconnectedPlayer(key: string): DisconnectedPlayerInfo | undefined
  removeDisconnectedPlayer(key: string): void
  clearAllDisconnectedPlayers(): void
  handleLocalPlayerSelection(roomId: string, playerId: string, data: unknown): Promise<{ status: string }>
  handleLocalReportAnimationEnd(roomId: string, playerId: string, data: unknown): Promise<{ status: string }>
  handleLocalIsTimerEnabled(roomId: string, playerId: string): Promise<boolean>
  handleLocalGetAllPlayerTimerStates(roomId: string, playerId: string): Promise<PlayerTimerState[]>
  handleLocalGetTimerConfig(roomId: string, playerId: string): Promise<TimerConfig>
  handleLocalStartAnimation(roomId: string, playerId: string, data: unknown): Promise<string>
  handleLocalEndAnimation(roomId: string, playerId: string, data: unknown): Promise<{ status: string }>
  handleLocalGetState(roomId: string, playerId: string): Promise<BattleState>
  handleLocalGetSelection(roomId: string, playerId: string): Promise<PlayerSelectionSchemaType[]>
  handleLocalReady(roomId: string, playerId: string): Promise<{ status: string }>
  recoverLocalBattleRuntime?(roomId: string): Promise<boolean>
  handleLocalGetBattleState(roomId: string, playerId: string): Promise<BattleState>
  handleLocalGetBattleHistory(roomId: string, playerId: string): Promise<BattleState>
  handleLocalGetBattleReport(roomId: string, playerId: string): Promise<{ battleRecordId: string }>
  handleLocalPlayerAbandon(roomId: string, playerId: string): Promise<{ status: string }>
  handleLocalBattleTermination(roomId: string, playerId: string, reason: string): Promise<{ status: string }>
  handleLocalGetPlayerTimerState(roomId: string, playerId: string, data: unknown): Promise<PlayerTimerState | null>
  forceTerminateBattle(roomState: RoomState, playerId: string, reason: string): Promise<void>
  cleanupLocalRoom(roomId: string): Promise<void>
  addToBatch(playerId: string, sessionId: string, message: BattleMessage): Promise<void>
  cleanupAllBatches(): Promise<void>
  cleanupPlayerBatches(playerId: string, sessionId: string): Promise<void>
  pauseBattleForDisconnect(roomId: string, playerId: string): Promise<void>
  resumeBattleAfterReconnect(roomId: string, playerId: string): Promise<void>
  notifyOpponentDisconnect(roomId: string, disconnectedPlayerId: string): Promise<void>
  sendBattleStateOnReconnect(roomId: string, playerId: string, sessionId: string): Promise<void>
  joinSpectateBattle(roomId: string, spectator: { playerId: string; sessionId: string }): Promise<boolean>
  removeSpectatorFromRoom(roomId: string, sessionId: string): Promise<void>
  forwardSpectatorMessage(roomId: string, messages: BattleMessage | BattleMessage[]): Promise<void>
  cleanupSpectatorsForRoom(roomId: string): void
}
