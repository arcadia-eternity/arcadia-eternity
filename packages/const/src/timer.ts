import type { playerId } from './const'

/**
 * 计时器配置接口
 */
export interface TimerConfig {
  /** 是否启用计时器系统 */
  enabled: boolean
  /** 每回合时间限制(秒) - 可选，不设置则无回合时间限制 */
  turnTimeLimit?: number
  /** 总思考时间限制(秒) - 可选，不设置则无总时间限制 */
  totalTimeLimit?: number
  /** 是否在动画期间暂停计时器 */
  animationPauseEnabled: boolean
  /** 动画时间窗口最大限制(毫秒) - 防止作弊 */
  maxAnimationDuration: number
}

/**
 * 默认计时器配置
 */
export const DEFAULT_TIMER_CONFIG: TimerConfig = {
  enabled: false,
  turnTimeLimit: 30, // 30秒每回合
  totalTimeLimit: 1500, // 5分钟总思考时间
  animationPauseEnabled: true,
  maxAnimationDuration: 20000, // 最大20秒动画时长，支持更长的技能动画
}

/**
 * 计时器系统常量
 * 这些值是固定的，不可配置
 */
export const TIMER_CONSTANTS = {
  /** 计时器更新间隔(毫秒) - 固定为1秒 */
  UPDATE_INTERVAL: 1000,
  /** 超时时自动选择第一个可用选项 - 固定启用 */
  AUTO_SELECT_ON_TIMEOUT: true,
  /** 前端本地计算器更新间隔(毫秒) - 100ms提供流畅体验 */
  LOCAL_CALCULATOR_INTERVAL: 100,
  /** Timer状态缓存TTL(毫秒) - 5分钟 */
  TIMER_CACHE_TTL: 5 * 60 * 1000,
  /** Timer事件批处理大小 */
  TIMER_EVENT_BATCH_SIZE: 10,
  /** Timer事件批处理超时(毫秒) */
  TIMER_EVENT_BATCH_TIMEOUT: 200,
} as const

/**
 * 计时器状态枚举
 */
export enum TimerState {
  Stopped = 'stopped',
  Running = 'running',
  Paused = 'paused',
  Timeout = 'timeout',
}

/**
 * 计时器超时类型
 */
export enum TimeoutType {
  Turn = 'turn',
  Total = 'total',
}

/**
 * 玩家计时器状态
 */
export interface PlayerTimerState {
  playerId: playerId
  state: TimerState
  remainingTurnTime: number // 剩余回合时间(秒)
  remainingTotalTime: number // 剩余总时间(秒)
  lastUpdateTime: number // 最后更新时间戳
}

/**
 * 动画追踪信息
 */
export interface AnimationInfo {
  id: string
  startTime: number
  expectedDuration: number
  actualDuration?: number
  source: string // petId 或 skillId
}

/**
 * 计时器事件类型
 */
export enum TimerEventType {
  Start = 'start',
  Update = 'update', // 保留用于兼容，但新架构中会减少使用
  Pause = 'pause',
  Resume = 'resume',
  Timeout = 'timeout',
  Stop = 'stop',
  // 新增事件类型
  Snapshot = 'snapshot', // Timer快照事件
  StateChange = 'stateChange', // Timer状态变化事件
}

/**
 * 计时器事件数据
 */
export interface TimerEvent {
  type: TimerEventType
  playerId?: playerId
  data?: any
  timestamp: number
}

/**
 * Timer快照 - 包含前端本地计算所需的所有信息
 */
export interface TimerSnapshot {
  /** 快照创建时间戳 */
  timestamp: number
  /** 玩家ID */
  playerId: playerId
  /** 计时器状态 */
  state: TimerState
  /** 快照时的剩余回合时间(秒) */
  remainingTurnTime: number
  /** 快照时的剩余总时间(秒) */
  remainingTotalTime: number
  /** 计时器配置 */
  config: TimerConfig
  /** 是否有活跃动画(影响计时) */
  hasActiveAnimations: boolean
  /** 暂停原因(如果处于暂停状态) */
  pauseReason?: 'animation' | 'system'
}

/**
 * Timer状态缓存项
 */
export interface TimerCacheItem {
  /** 缓存的Timer快照 */
  snapshot: TimerSnapshot
  /** 缓存创建时间 */
  cachedAt: number
  /** 缓存TTL */
  ttl: number
}

/**
 * Timer事件批处理项
 */
export interface TimerEventBatch {
  /** 批处理中的事件列表 */
  events: TimerEvent[]
  /** 批处理创建时间 */
  createdAt: number
  /** 批处理定时器 */
  timer?: ReturnType<typeof setTimeout>
}
