// gRPC 类型适配器
import * as grpc from '@grpc/grpc-js'
import type * as BattleRpc from './battle-rpc'

// 重新导出所有类型
export type PlayerSelectionRequest = BattleRpc.PlayerSelectionRequest
export type PlayerSelectionResponse = BattleRpc.PlayerSelectionResponse
export type SelectionRequest = BattleRpc.SelectionRequest
export type SelectionResponse = BattleRpc.SelectionResponse
export type BattleStateRequest = BattleRpc.BattleStateRequest
export type BattleStateResponse = BattleRpc.BattleStateResponse
export type ReadyRequest = BattleRpc.ReadyRequest
export type ReadyResponse = BattleRpc.ReadyResponse
export type AbandonRequest = BattleRpc.AbandonRequest
export type AbandonResponse = BattleRpc.AbandonResponse
export type AnimationEndRequest = BattleRpc.AnimationEndRequest
export type AnimationEndResponse = BattleRpc.AnimationEndResponse
export type TimerEnabledRequest = BattleRpc.TimerEnabledRequest
export type TimerEnabledResponse = BattleRpc.TimerEnabledResponse
export type PlayerTimerStateRequest = BattleRpc.PlayerTimerStateRequest
export type PlayerTimerStateResponse = BattleRpc.PlayerTimerStateResponse
export type AllPlayerTimerStatesRequest = BattleRpc.AllPlayerTimerStatesRequest
export type AllPlayerTimerStatesResponse = BattleRpc.AllPlayerTimerStatesResponse
export type TimerConfigRequest = BattleRpc.TimerConfigRequest
export type TimerConfigResponse = BattleRpc.TimerConfigResponse
export type StartAnimationRequest = BattleRpc.StartAnimationRequest
export type StartAnimationResponse = BattleRpc.StartAnimationResponse
export type EndAnimationRequest = BattleRpc.EndAnimationRequest
export type EndAnimationResponse = BattleRpc.EndAnimationResponse
export type TerminateBattleRequest = BattleRpc.TerminateBattleRequest
export type TerminateBattleResponse = BattleRpc.TerminateBattleResponse
export type CreateBattleRequest = BattleRpc.CreateBattleRequest
export type CreateBattleResponse = BattleRpc.CreateBattleResponse

// gRPC 服务器端类型定义
export interface TypedBattleServiceClient {
  SubmitPlayerSelection: (
    request: PlayerSelectionRequest,
    callback: grpc.requestCallback<PlayerSelectionResponse>,
  ) => void
  GetAvailableSelection: (request: SelectionRequest, callback: grpc.requestCallback<SelectionResponse>) => void
  GetBattleState: (request: BattleStateRequest, callback: grpc.requestCallback<BattleStateResponse>) => void
  PlayerReady: (request: ReadyRequest, callback: grpc.requestCallback<ReadyResponse>) => void
  PlayerAbandon: (request: AbandonRequest, callback: grpc.requestCallback<AbandonResponse>) => void
  ReportAnimationEnd: (request: AnimationEndRequest, callback: grpc.requestCallback<AnimationEndResponse>) => void
  IsTimerEnabled: (request: TimerEnabledRequest, callback: grpc.requestCallback<TimerEnabledResponse>) => void
  GetPlayerTimerState: (
    request: PlayerTimerStateRequest,
    callback: grpc.requestCallback<PlayerTimerStateResponse>,
  ) => void
  GetAllPlayerTimerStates: (
    request: AllPlayerTimerStatesRequest,
    callback: grpc.requestCallback<AllPlayerTimerStatesResponse>,
  ) => void
  GetTimerConfig: (request: TimerConfigRequest, callback: grpc.requestCallback<TimerConfigResponse>) => void
  StartAnimation: (request: StartAnimationRequest, callback: grpc.requestCallback<StartAnimationResponse>) => void
  EndAnimation: (request: EndAnimationRequest, callback: grpc.requestCallback<EndAnimationResponse>) => void
  TerminateBattle: (request: TerminateBattleRequest, callback: grpc.requestCallback<TerminateBattleResponse>) => void
  CreateBattle: (request: CreateBattleRequest, callback: grpc.requestCallback<CreateBattleResponse>) => void
}

// gRPC 服务器端处理器类型定义
export type TypedServerUnaryCall<TRequest> = grpc.ServerUnaryCall<TRequest, any>
export type TypedSendUnaryData<TResponse> = grpc.sendUnaryData<TResponse>

// 服务器端方法签名类型
export interface TypedBattleServiceHandlers {
  SubmitPlayerSelection: (
    call: TypedServerUnaryCall<PlayerSelectionRequest>,
    callback: TypedSendUnaryData<PlayerSelectionResponse>,
  ) => Promise<void>
  GetAvailableSelection: (
    call: TypedServerUnaryCall<SelectionRequest>,
    callback: TypedSendUnaryData<SelectionResponse>,
  ) => Promise<void>
  GetBattleState: (
    call: TypedServerUnaryCall<BattleStateRequest>,
    callback: TypedSendUnaryData<BattleStateResponse>,
  ) => Promise<void>
  PlayerReady: (call: TypedServerUnaryCall<ReadyRequest>, callback: TypedSendUnaryData<ReadyResponse>) => Promise<void>
  PlayerAbandon: (
    call: TypedServerUnaryCall<AbandonRequest>,
    callback: TypedSendUnaryData<AbandonResponse>,
  ) => Promise<void>
  ReportAnimationEnd: (
    call: TypedServerUnaryCall<AnimationEndRequest>,
    callback: TypedSendUnaryData<AnimationEndResponse>,
  ) => Promise<void>
  IsTimerEnabled: (
    call: TypedServerUnaryCall<TimerEnabledRequest>,
    callback: TypedSendUnaryData<TimerEnabledResponse>,
  ) => Promise<void>
  GetPlayerTimerState: (
    call: TypedServerUnaryCall<PlayerTimerStateRequest>,
    callback: TypedSendUnaryData<PlayerTimerStateResponse>,
  ) => Promise<void>
  GetAllPlayerTimerStates: (
    call: TypedServerUnaryCall<AllPlayerTimerStatesRequest>,
    callback: TypedSendUnaryData<AllPlayerTimerStatesResponse>,
  ) => Promise<void>
  GetTimerConfig: (
    call: TypedServerUnaryCall<TimerConfigRequest>,
    callback: TypedSendUnaryData<TimerConfigResponse>,
  ) => Promise<void>
  StartAnimation: (
    call: TypedServerUnaryCall<StartAnimationRequest>,
    callback: TypedSendUnaryData<StartAnimationResponse>,
  ) => Promise<void>
  EndAnimation: (
    call: TypedServerUnaryCall<EndAnimationRequest>,
    callback: TypedSendUnaryData<EndAnimationResponse>,
  ) => Promise<void>
  TerminateBattle: (
    call: TypedServerUnaryCall<TerminateBattleRequest>,
    callback: TypedSendUnaryData<TerminateBattleResponse>,
  ) => Promise<void>
  CreateBattle: (
    call: TypedServerUnaryCall<CreateBattleRequest>,
    callback: TypedSendUnaryData<CreateBattleResponse>,
  ) => Promise<void>
}
