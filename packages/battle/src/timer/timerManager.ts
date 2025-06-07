import {
  type playerId,
  type TimerConfig,
  DEFAULT_TIMER_CONFIG,
  TimeoutType,
  type PlayerTimerState,
  type TimerEvent,
  TimerEventType,
  TIMER_CONSTANTS,
  BattleStatus,
  BattlePhase,
} from '@arcadia-eternity/const'
import mitt, { type Emitter } from 'mitt'
import { BattleTimer } from './battleTimer'
import { AnimationTracker } from './animationTracker'
import type { Battle } from '../battle'

type TimerManagerEvents = {
  animationStart: any
  animationEnd: any
  animationForceEnd: any
  timerEvent: TimerEvent
}

/**
 * 计时器管理器
 * 管理整个战斗的计时状态，协调多个BattleTimer实例
 */
export class TimerManager {
  private playerTimers: Map<playerId, BattleTimer> = new Map()
  private animationTracker: AnimationTracker
  private config: TimerConfig
  private isActive: boolean = false
  private currentPhase: 'selection' | 'execution' | 'switch' | null = null
  private pendingTurnReset: { playerIds: playerId[] } | null = null
  private emitter: Emitter<TimerManagerEvents> = mitt<TimerManagerEvents>()

  // 追踪玩家选择状态
  private playerSelectionStatus: Map<playerId, boolean> = new Map()

  constructor(
    private readonly battle: Battle,
    config?: Partial<TimerConfig>,
  ) {
    this.config = { ...DEFAULT_TIMER_CONFIG, ...config }
    this.animationTracker = new AnimationTracker(this.config)

    // 设置动画超时回调
    this.animationTracker.setTimeoutCallback((animationId, ownerId) => {
      console.debug(
        `TimerManager: animation ${animationId} timed out, owner: ${ownerId}, timers will automatically resume`,
      )
    })

    this.setupEventHandlers()
  }

  /**
   * 初始化玩家计时器
   */
  public initializePlayerTimers(playerIds: playerId[]): void {
    if (!this.config.enabled) return

    // 清理现有计时器
    this.cleanup()

    // 为每个玩家创建计时器
    playerIds.forEach(playerId => {
      const timer = new BattleTimer(playerId, this.config)
      this.playerTimers.set(playerId, timer)

      // 设置检查活跃动画的回调
      timer.setHasActiveAnimationsCallback(() => {
        return this.animationTracker.hasActiveAnimations()
      })

      // 监听计时器事件
      timer.on('timerEvent', (event: TimerEvent) => {
        this.handleTimerEvent(event)
      })
    })
  }

  /**
   * 开始新回合计时
   */
  public startNewTurn(playerIds: playerId[]): void {
    if (!this.config.enabled) return

    console.debug(`Timer startNewTurn: starting new turn for players: ${playerIds.join(', ')}`)

    this.currentPhase = 'selection'
    this.isActive = true

    // 重置选择状态追踪
    this.playerSelectionStatus.clear()
    playerIds.forEach(playerId => {
      this.playerSelectionStatus.set(playerId, false)
    })

    // 检查是否有活跃的动画
    if (this.animationTracker.hasActiveAnimations()) {
      console.debug('Timer startNewTurn: active animations detected, deferring timer reset')
      // 如果有活跃动画，先暂停所有计时器，等动画结束后再重置
      this.pauseTimers(playerIds, 'system')

      // 记录需要重置的玩家ID，等动画结束后处理
      this.pendingTurnReset = { playerIds }

      // 发送计时器开始事件（使用当前状态）
      const remainingTotalTime: { [key: string]: number } = {}
      playerIds.forEach(playerId => {
        const timer = this.playerTimers.get(playerId)
        if (timer) {
          const state = timer.getState()
          remainingTotalTime[playerId] = state.remainingTotalTime
        }
      })

      this.battle.emitter.emit('timerStart', {
        player: playerIds,
        turnTimeLimit: this.config.turnTimeLimit || null,
        remainingTotalTime,
      })
      return
    }

    // 重置并启动计时器到新回合状态
    const remainingTotalTime: { [key: string]: number } = {}

    playerIds.forEach(playerId => {
      const timer = this.playerTimers.get(playerId)
      if (timer) {
        console.debug(`Timer startNewTurn: resetting and starting timer for player ${playerId}`)
        timer.resetTurn() // 重置并启动
        const state = timer.getState()
        remainingTotalTime[playerId] = state.remainingTotalTime
      }
    })

    // 发送计时器开始事件
    this.battle.emitter.emit('timerStart', {
      player: playerIds,
      turnTimeLimit: this.config.turnTimeLimit || null,
      remainingTotalTime,
    })

    console.debug('Timer startNewTurn: timers reset and started, ready for animation management')
  }

  /**
   * 开始切换阶段计时
   */
  public startSwitchPhase(playerIds: playerId[]): void {
    if (!this.config.enabled) return

    this.currentPhase = 'switch'
    this.isActive = true

    // 重置选择状态追踪
    this.playerSelectionStatus.clear()
    playerIds.forEach(playerId => {
      this.playerSelectionStatus.set(playerId, false)
    })

    // 启动指定玩家的计时器
    const remainingTotalTime: { [key: string]: number } = {}

    playerIds.forEach(playerId => {
      const timer = this.playerTimers.get(playerId)
      if (timer) {
        timer.startTurn()
        const state = timer.getState()
        remainingTotalTime[playerId] = state.remainingTotalTime
      }
    })

    // 发送计时器开始事件
    this.battle.emitter.emit('timerStart', {
      player: playerIds,
      turnTimeLimit: this.config.turnTimeLimit || null,
      remainingTotalTime,
    })
  }

  /**
   * 暂停计时器（动画播放期间）
   */
  public pauseTimers(playerIds: playerId[], reason: 'animation' | 'system' = 'animation'): void {
    console.debug(
      `Timer pauseTimers: enabled=${this.config.enabled}, animationPauseEnabled=${this.config.animationPauseEnabled}, reason=${reason}, players=${playerIds.join(', ')}`,
    )

    if (!this.config.enabled || !this.config.animationPauseEnabled) {
      console.debug('Timer pauseTimers: skipping due to config')
      return
    }

    playerIds.forEach(playerId => {
      const timer = this.playerTimers.get(playerId)
      if (timer) {
        const stateBefore = timer.getState().state
        timer.pause(reason)
        const stateAfter = timer.getState().state
        console.debug(`Timer pauseTimers: player ${playerId} state changed from ${stateBefore} to ${stateAfter}`)
      }
    })

    // 发送暂停事件
    this.battle.emitter.emit('timerPause', {
      player: playerIds,
      reason,
    })
  }

  /**
   * 恢复计时器
   */
  public resumeTimers(playerIds: playerId[]): void {
    if (!this.config.enabled) return

    console.debug(`Timer resumeTimers: resuming timers for players: ${playerIds.join(', ')}`)

    playerIds.forEach(playerId => {
      const timer = this.playerTimers.get(playerId)
      if (timer) {
        const stateBefore = timer.getState().state
        timer.resume()
        const stateAfter = timer.getState().state
        console.debug(`Timer resumeTimers: player ${playerId} state changed from ${stateBefore} to ${stateAfter}`)
      }
    })

    // 发送恢复事件
    this.battle.emitter.emit('timerResume', {
      player: playerIds,
    })
  }

  /**
   * 停止所有计时器
   */
  public stopAllTimers(): void {
    this.isActive = false
    this.currentPhase = null

    this.playerTimers.forEach(timer => {
      timer.stop()
    })
  }

  /**
   * 处理玩家选择状态变化
   * 当一方选择完毕且等待对方选择时，暂停己方的timer
   */
  public handlePlayerSelectionChange(playerId: playerId, hasSelection: boolean): void {
    if (!this.config.enabled || (this.currentPhase !== 'selection' && this.currentPhase !== 'switch')) return

    console.debug(`Timer handlePlayerSelectionChange: player ${playerId} selection status: ${hasSelection}`)

    // 更新选择状态
    this.playerSelectionStatus.set(playerId, hasSelection)

    // 获取所有玩家的选择状态
    const allPlayerIds = Array.from(this.playerSelectionStatus.keys())
    const playersWithSelection = allPlayerIds.filter(id => this.playerSelectionStatus.get(id))
    const playersWithoutSelection = allPlayerIds.filter(id => !this.playerSelectionStatus.get(id))

    console.debug(
      `Timer handlePlayerSelectionChange: players with selection: [${playersWithSelection.join(', ')}], without selection: [${playersWithoutSelection.join(', ')}]`,
    )

    // 如果有玩家已选择但还有玩家未选择，暂停已选择玩家的timer
    if (playersWithSelection.length > 0 && playersWithoutSelection.length > 0) {
      // 暂停已选择玩家的timer
      const playersToResume: playerId[] = []
      const playersToPause: playerId[] = []

      playersWithSelection.forEach(id => {
        const timer = this.playerTimers.get(id)
        if (timer && timer.getState().state === 'running') {
          playersToPause.push(id)
        }
      })

      playersWithoutSelection.forEach(id => {
        const timer = this.playerTimers.get(id)
        if (timer && timer.getState().state === 'paused') {
          playersToResume.push(id)
        }
      })

      if (playersToPause.length > 0) {
        console.debug(
          `Timer handlePlayerSelectionChange: pausing timers for players who have made selections: [${playersToPause.join(', ')}]`,
        )
        this.pauseTimers(playersToPause, 'system')
      }

      if (playersToResume.length > 0) {
        console.debug(
          `Timer handlePlayerSelectionChange: resuming timers for players who haven't made selections: [${playersToResume.join(', ')}]`,
        )
        this.resumeTimers(playersToResume)
      }
    } else if (playersWithSelection.length === allPlayerIds.length) {
      // 所有玩家都已选择，暂停所有timer
      console.debug('Timer handlePlayerSelectionChange: all players have made selections, pausing all timers')
      this.pauseTimers(allPlayerIds, 'system')
    } else if (playersWithSelection.length === 0 && playersWithoutSelection.length === allPlayerIds.length) {
      // 所有玩家都没有选择，恢复所有被系统暂停的timer
      console.debug(
        'Timer handlePlayerSelectionChange: all players have no selections, resuming all system-paused timers',
      )
      const playersToResume: playerId[] = []

      allPlayerIds.forEach(id => {
        const timer = this.playerTimers.get(id)
        if (timer) {
          const state = timer.getState().state
          // 只恢复被系统暂停的计时器，不恢复被动画暂停的计时器
          if (state === 'paused') {
            // 检查是否有活跃动画正在影响这个玩家的计时器
            const hasActiveAnimationForPlayer = this.animationTracker.getActiveAnimations().some(animation => {
              const animationOwner = this.animationTracker.getAnimationOwner(animation.id)
              return animationOwner === id
            })

            if (!hasActiveAnimationForPlayer) {
              playersToResume.push(id)
            } else {
              console.debug(`Timer handlePlayerSelectionChange: keeping timer paused for ${id} due to active animation`)
            }
          }
        }
      })

      if (playersToResume.length > 0) {
        console.debug(
          `Timer handlePlayerSelectionChange: resuming timers for all deselected players: [${playersToResume.join(', ')}]`,
        )
        this.resumeTimers(playersToResume)
      }
    }
  }

  /**
   * 开始动画追踪
   */
  public startAnimation(source: string, expectedDuration: number, ownerId: playerId): string {
    console.debug(
      `Timer startAnimation: enabled=${this.config.enabled}, isActive=${this.isActive}, source=${source}, ownerId=${ownerId}`,
    )

    if (!this.config.enabled) {
      console.debug('Timer startAnimation: returning disabled due to config')
      return 'disabled'
    }

    const animationId = this.animationTracker.startAnimation(source, expectedDuration, undefined, ownerId)

    console.debug(
      `Timer startAnimation: started animation ${animationId}, timers will automatically pause during animation`,
    )

    // 发送动画开始事件
    this.battle.emitter.emit('animationStart', {
      animationId,
      duration: expectedDuration,
      source: source as any, // 临时类型转换，实际使用时应该传入正确的petId或skillId
    })

    return animationId
  }

  /**
   * 结束动画追踪
   */
  public endAnimation(animationId: string, actualDuration?: number): void {
    if (!this.config.enabled || animationId === 'disabled') return

    console.debug(`Timer endAnimation: ending animation ${animationId}, actualDuration=${actualDuration}`)

    // 尝试结束动画追踪
    const animationEnded = this.animationTracker.endAnimation(animationId, actualDuration)

    if (!animationEnded) {
      console.debug(`Timer endAnimation: animation ${animationId} was already cleaned up (likely due to timeout)`)
      return
    }

    console.debug(`Timer endAnimation: animation ${animationId} ended, timers will automatically resume`)

    // 检查是否有待重置的回合（只有在没有活跃动画时才处理）
    if (!this.animationTracker.hasActiveAnimations() && this.pendingTurnReset) {
      console.debug('Timer endAnimation: processing pending turn reset')
      const pending = this.pendingTurnReset
      this.pendingTurnReset = null

      // 重置并启动计时器到新回合状态
      const remainingTotalTime: { [key: string]: number } = {}

      pending.playerIds.forEach(playerId => {
        const timer = this.playerTimers.get(playerId)
        if (timer) {
          console.debug(`Timer endAnimation: resetting timer for player ${playerId}`)
          timer.resetTurn()
          const state = timer.getState()
          remainingTotalTime[playerId] = state.remainingTotalTime
        }
      })

      // 发送计时器重置事件
      this.battle.emitter.emit('timerStart', {
        player: pending.playerIds,
        turnTimeLimit: this.config.turnTimeLimit || null,
        remainingTotalTime,
      })
    }

    // 发送动画结束事件
    this.battle.emitter.emit('animationEnd', {
      animationId,
      actualDuration: actualDuration || 0,
    })
  }

  /**
   * 获取玩家计时器状态
   */
  public getPlayerState(playerId: playerId): PlayerTimerState | null {
    const timer = this.playerTimers.get(playerId)
    return timer ? timer.getState() : null
  }

  /**
   * 获取所有玩家状态
   */
  public getAllPlayerStates(): PlayerTimerState[] {
    return Array.from(this.playerTimers.values()).map(timer => timer.getState())
  }

  /**
   * 检查是否启用
   */
  public isEnabled(): boolean {
    return this.config.enabled
  }

  /**
   * 获取配置
   */
  public getConfig(): TimerConfig {
    return { ...this.config }
  }

  /**
   * 更新配置
   */
  public updateConfig(newConfig: Partial<TimerConfig>): void {
    this.config = { ...this.config, ...newConfig }
  }

  /**
   * 事件监听方法
   */
  public on<K extends keyof TimerManagerEvents>(type: K, handler: (event: TimerManagerEvents[K]) => void): void {
    this.emitter.on(type, handler)
  }

  public off<K extends keyof TimerManagerEvents>(type: K, handler: (event: TimerManagerEvents[K]) => void): void {
    this.emitter.off(type, handler)
  }

  private emit<K extends keyof TimerManagerEvents>(type: K, event: TimerManagerEvents[K]): void {
    this.emitter.emit(type, event)
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    // 监听动画追踪器事件
    this.animationTracker.on('animationStart', data => {
      this.emit('animationStart', data)
    })

    this.animationTracker.on('animationEnd', data => {
      this.emit('animationEnd', data)
    })

    this.animationTracker.on('animationForceEnd', data => {
      console.debug(
        `Timer setupEventHandlers: animation force ended ${data.animationId}, reason: ${data.reason}, owner: ${data.ownerId}`,
      )
      this.emit('animationForceEnd', data)
    })
  }

  /**
   * 处理计时器事件
   */
  private handleTimerEvent(event: TimerEvent): void {
    switch (event.type) {
      case TimerEventType.Update:
        this.handleTimerUpdate(event)
        break
      case TimerEventType.Timeout:
        this.handleTimerTimeout(event)
        break
      default:
        // 转发其他事件
        this.emit('timerEvent', event)
        break
    }
  }

  /**
   * 处理计时器更新
   */
  private handleTimerUpdate(event: TimerEvent): void {
    if (!event.playerId) return

    const timer = this.playerTimers.get(event.playerId)
    if (!timer) return

    const state = timer.getState()

    // 发送更新事件
    this.battle.emitter.emit('timerUpdate', {
      player: event.playerId,
      remainingTurnTime: state.remainingTurnTime,
      remainingTotalTime: state.remainingTotalTime,
    })
  }

  /**
   * 处理计时器超时
   */
  private handleTimerTimeout(event: TimerEvent): void {
    if (!event.playerId || !event.data?.type) return

    const timeoutType = event.data.type as TimeoutType
    let autoAction: string | undefined

    // 处理超时逻辑 - autoSelectOnTimeout 现在是固定启用的
    if (timeoutType === TimeoutType.Turn && TIMER_CONSTANTS.AUTO_SELECT_ON_TIMEOUT) {
      autoAction = this.handleTurnTimeout(event.playerId)
    } else if (timeoutType === TimeoutType.Total) {
      this.handleTotalTimeout(event.playerId)
    }

    // 发送超时事件
    this.battle.emitter.emit('timerTimeout', {
      player: event.playerId,
      type: timeoutType,
      autoAction,
    })
  }

  /**
   * 处理回合超时
   */
  private handleTurnTimeout(playerId: playerId): string {
    // 获取第一个可用选项并自动选择
    const availableSelections = this.battle.getAvailableSelection(playerId)
    if (availableSelections.length > 0) {
      const firstSelection = availableSelections[0]
      const success = this.battle.setSelection(firstSelection)
      if (success) {
        return `自动选择: ${this.getSelectionDescription(firstSelection)}`
      } else {
        return '自动选择失败'
      }
    }
    return '无可用选项'
  }

  /**
   * 获取选择的描述
   */
  private getSelectionDescription(selection: any): string {
    switch (selection.type) {
      case 'use-skill':
        return `使用技能 ${selection.skill}`
      case 'switch-pet':
        return `切换精灵 ${selection.pet}`
      case 'do-nothing':
        return '什么都不做'
      case 'surrender':
        return '投降'
      default:
        return selection.type
    }
  }

  /**
   * 处理总时间超时
   */
  private handleTotalTimeout(playerId: playerId): void {
    // 总时间耗尽，玩家判负
    const opponent = this.battle.getOpponent(this.battle.getPlayerByID(playerId))
    this.battle.victor = opponent
    this.battle.status = BattleStatus.Ended
    this.battle.currentPhase = BattlePhase.Ended
    // 停止所有计时器
    this.stopAllTimers()
    this.battle.getVictor(true, 'total_time_timeout')
  }

  /**
   * 清理资源
   */
  public cleanup(): void {
    this.stopAllTimers()

    this.playerTimers.forEach(timer => {
      timer.cleanup()
    })
    this.playerTimers.clear()

    this.animationTracker.cleanup()
    this.emitter.all.clear()
  }
}
