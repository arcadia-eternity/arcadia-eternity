import type { Socket } from 'socket.io'
import type { AckResponse } from '@arcadia-eternity/protocol'
import type { RoomState, MatchmakingEntry, ServiceInstance } from '../../../cluster/types'

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
export interface IBattleDependencies {
  // 目前战斗服务没有外部依赖，保留接口以备将来扩展
}

// 匹配服务回调接口
export interface MatchmakingCallbacks {
  createLocalBattle: (roomState: RoomState, player1Data: any, player2Data: any) => Promise<any>
  sendToPlayerSession: (playerId: string, sessionId: string, event: string, data: any) => Promise<boolean>
  getPlayerName: (playerId: string) => Promise<string>
  createSessionRoomMappings: (roomState: RoomState) => Promise<void>
  verifyInstanceReachability: (instance: ServiceInstance) => Promise<boolean>
  createClusterBattleRoom: (player1Entry: any, player2Entry: any) => Promise<string | null>
}

// 战斗服务回调接口
export interface BattleCallbacks {
  sendToPlayerSession: (playerId: string, sessionId: string, event: string, data: any) => Promise<boolean>
  addToBatch: (playerId: string, sessionId: string, message: any) => Promise<void>
  cleanupSessionRoomMappings: (roomState: RoomState) => Promise<void>
  forwardPlayerAction: (instanceId: string, action: string, playerId: string, data: any) => Promise<any>
  createSessionRoomMappings: (roomState: RoomState) => Promise<void>
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
  createLocalBattle(roomState: RoomState, player1Data: any, player2Data: any): Promise<any>
  createClusterBattleRoom(player1Entry: MatchmakingEntry, player2Entry: MatchmakingEntry): Promise<string | null>
  getLocalBattle(roomId: string): any
  isRoomInCurrentInstance(roomState: RoomState): boolean
  getAllLocalRooms(): Map<string, any>
  getLocalRoom(roomId: string): any
  addDisconnectedPlayer(playerId: string, sessionId: string, roomId: string): void
  getDisconnectedPlayer(key: string): any
  removeDisconnectedPlayer(key: string): void
  clearAllDisconnectedPlayers(): void
  handleLocalPlayerSelection(roomId: string, playerId: string, data: any): Promise<{ status: string }>
  handleLocalReportAnimationEnd(roomId: string, playerId: string, data: any): Promise<{ status: string }>
  handleLocalIsTimerEnabled(roomId: string, playerId: string): Promise<boolean>
  handleLocalGetAllPlayerTimerStates(roomId: string, playerId: string): Promise<any[]>
  handleLocalGetTimerConfig(roomId: string, playerId: string): Promise<any>
  handleLocalStartAnimation(roomId: string, playerId: string, data: any): Promise<string>
  handleLocalEndAnimation(roomId: string, playerId: string, data: any): Promise<{ status: string }>
  handleLocalGetState(roomId: string, playerId: string): Promise<any>
  handleLocalGetSelection(roomId: string, playerId: string): Promise<any>
  handleLocalReady(roomId: string, playerId: string): Promise<{ status: string }>
  handleLocalGetBattleState(roomId: string, playerId: string): Promise<any>
  handleLocalGetBattleHistory(roomId: string, playerId: string): Promise<any>
  handleLocalGetBattleReport(roomId: string, playerId: string): Promise<any>
  handleLocalPlayerAbandon(roomId: string, playerId: string): Promise<any>
  handleLocalBattleTermination(roomId: string, playerId: string, reason: string): Promise<any>
  handleLocalGetPlayerTimerState(roomId: string, playerId: string, data: any): Promise<any>
  forceTerminateBattle(roomState: RoomState, playerId: string, reason: string): Promise<void>
  cleanupLocalRoom(roomId: string): Promise<void>
  addToBatch(playerId: string, sessionId: string, message: any): Promise<void>
  cleanupAllBatches(): Promise<void>
  cleanupPlayerBatches(playerId: string, sessionId: string): Promise<void>
  pauseBattleForDisconnect(roomId: string, playerId: string): Promise<void>
  resumeBattleAfterReconnect(roomId: string, playerId: string): Promise<void>
  notifyOpponentDisconnect(roomId: string, disconnectedPlayerId: string): Promise<void>
  sendBattleStateOnReconnect(roomId: string, playerId: string, sessionId: string): Promise<void>
}
