import { defineStore } from 'pinia'
import { Subject } from 'rxjs'
import {
  type BattleState,
  type BattleMessage,
  BattleMessageType,
  type petId,
  type playerId,
  type PlayerSelection,
  type TeamSelectionConfig,
  type PetMessage,
  type SkillMessage,
  type PlayerMessage,
  type MarkMessage,
} from '@arcadia-eternity/const'
import type { IBattleSystem, IDeveloperBattleSystem } from '@arcadia-eternity/interface'
import * as jsondiffpatch from 'jsondiffpatch'
import { markRaw, toRaw } from 'vue'
import { useCloned } from '@vueuse/core'
import { ReplayBattleInterface } from './replayBattleInterface'
import { usePlayerStore } from './player'
import { useEloStore } from './elo'

type BattleEventWithView = (
  callback: (message: BattleMessage) => void,
  options?: { viewerId?: playerId; showHidden?: boolean; showAll?: boolean },
) => () => void

// 类型守卫函数：检查battleInterface是否支持开发者功能
function isDeveloperBattleSystem(
  battleInterface: IBattleSystem,
): battleInterface is IBattleSystem & IDeveloperBattleSystem {
  return (
    'setDevPetHp' in battleInterface &&
    'setDevPlayerRage' in battleInterface &&
    'forceAISelection' in battleInterface &&
    'getAvailableActionsForPlayer' in battleInterface
  )
}

function isP2PPeerBattleSystem(battleInterface: IBattleSystem | null): battleInterface is IBattleSystem & {
  battleRuntimeType: 'p2p-peer'
} {
  return !!battleInterface && 'battleRuntimeType' in battleInterface && battleInterface.battleRuntimeType === 'p2p-peer'
}

function isBattleUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const upper = message.toUpperCase()
  return (
    upper.includes('NOT_IN_BATTLE')
    || upper.includes('BATTLE_NOT_FOUND')
    || upper.includes('BATTLE_ALREADY_ENDED')
    || upper.includes('BATTLE IS NOT ACTIVE')
  )
}

// 带时间戳的战斗消息类型
export type TimestampedBattleMessage = BattleMessage & {
  receivedAt: number // 消息接收时的时间戳
}

export const useBattleStore = defineStore('battle', {
  state: () => ({
    battleInterface: null as IBattleSystem | null,
    battleState: null as BattleState | null,
    log: [] as TimestampedBattleMessage[],
    availableActions: [] as PlayerSelection[],
    errorMessage: null as string | null,
    isBattleEnd: false,
    victor: '' as string | null,
    playerId: '',
    // RxJS相关状态
    _messageSubject: new Subject<BattleMessage>(),
    animateQueue: new Subject<() => Promise<void>>(),
    // 用于跟踪已处理的消息序号
    lastProcessedSequenceId: -1,
    // 战斗事件监听器清理函数，用于防止重复注册
    _battleEventUnsubscribe: null as (() => void) | null,
    // 回放模式相关状态
    isReplayMode: false,
    replayMessages: [] as BattleMessage[],
    replaySnapshots: [] as Array<{
      type: 'turnStart' | 'battleEnd'
      turnNumber: number
      messageIndex: number // 快照对应的消息索引
      state: BattleState // 快照状态
      label: string // 显示标签
    }>,
    currentSnapshotIndex: 0,
    totalSnapshots: 0,
    waitingForResponse: false,
    // 团队选择相关状态
    teamSelectionActive: false,
    teamSelectionConfig: null as TeamSelectionConfig | null,
    teamSelectionTimeRemaining: 0,
  }),

  actions: {
    async initBattle(battleInterface: IBattleSystem, playerId: string) {
      // 清理旧的战斗事件监听器
      if (this._battleEventUnsubscribe) {
        console.log('🔄 Cleaning up previous battle event listener')
        this._battleEventUnsubscribe()
        this._battleEventUnsubscribe = null
      }

      this.battleInterface = markRaw(battleInterface)
      this.playerId = playerId
      this.battleState = await this.battleInterface.getState(playerId as playerId, false)
      this.isBattleEnd = this.battleState?.status === 'Ended'
      this.victor = null
      this.errorMessage = null
      // 初始化RxJS流
      // 使用响应式方式清空log数组
      this.log.splice(0, this.log.length)
      this._messageSubject = new Subject<BattleMessage>()
      // 使用battleState中的sequenceId来设置lastProcessedSequenceId，帮助客户端判断从哪个状态开始
      this.lastProcessedSequenceId = this.battleState?.sequenceId ?? -1

      // 注册新的战斗事件监听器并保存清理函数
      this._battleEventUnsubscribe = (this.battleInterface.BattleEvent as BattleEventWithView)(
        msg => {
          this.waitingForResponse = false
          this.handleBattleMessage(msg)
        },
        { viewerId: this.playerId as playerId, showHidden: false },
      )
      console.log('🔄 Registered new battle event listener')

      this.availableActions = this.isBattleEnd ? [] : await this.fetchAvailableSelection()
    },

    // 使用服务器提供的战斗状态初始化战斗，避免额外的 getState 调用
    async initBattleWithState(battleInterface: IBattleSystem, playerId: string, battleState: BattleState) {
      // 清理旧的战斗事件监听器
      if (this._battleEventUnsubscribe) {
        console.log('🔄 Cleaning up previous battle event listener')
        this._battleEventUnsubscribe()
        this._battleEventUnsubscribe = null
      }

      this.battleInterface = markRaw(battleInterface)
      this.playerId = playerId
      this.battleState = battleState // 直接使用服务器提供的状态
      this.isBattleEnd = this.battleState?.status === 'Ended'
      this.victor = null
      this.errorMessage = null
      // 初始化RxJS流
      // 使用响应式方式清空log数组
      this.log.splice(0, this.log.length)
      this._messageSubject = new Subject<BattleMessage>()
      // 使用battleState中的sequenceId来设置lastProcessedSequenceId，帮助客户端判断从哪个状态开始
      this.lastProcessedSequenceId = battleState?.sequenceId ?? -1

      // 注册新的战斗事件监听器并保存清理函数
      this._battleEventUnsubscribe = (this.battleInterface.BattleEvent as BattleEventWithView)(
        msg => {
          this.waitingForResponse = false
          this.handleBattleMessage(msg)
        },
        { viewerId: this.playerId as playerId, showHidden: false },
      )
      console.log('🔄 Registered new battle event listener')

      this.availableActions = this.isBattleEnd ? [] : await this.fetchAvailableSelection()
    },

    replaceP2PPeerState(battleState: BattleState, availableSelections: PlayerSelection[]) {
      if (!isP2PPeerBattleSystem(this.battleInterface)) {
        return
      }

      this.battleState = battleState
      this.availableActions = availableSelections
      this.lastProcessedSequenceId = battleState.sequenceId ?? this.lastProcessedSequenceId
      this.waitingForResponse = false
      this.errorMessage = null
    },

    async ready() {
      await this.battleInterface?.ready()
    },

    async sendplayerSelection(selection: PlayerSelection) {
      const availableActionsCache = useCloned(this.availableActions)
      this.availableActions = []
      this.waitingForResponse = true
      try {
        await this.battleInterface?.submitAction(toRaw(selection) as PlayerSelection)
      } catch (error) {
        if (isBattleUnavailableError(error)) {
          this.waitingForResponse = false
          this.availableActions = []
          this.isBattleEnd = true
          this.errorMessage = '战斗已结束'
          return
        }
        this.errorMessage = (error as Error).message
        try {
          this.availableActions = await this.fetchAvailableSelection()
          this.waitingForResponse = false
        } catch (fetchError) {
          this.errorMessage = (fetchError as Error).message
          this.availableActions = availableActionsCache.cloned.value
          this.waitingForResponse = false
        }
      }
    },

    // 团队选择相关方法
    startTeamSelection(config: TeamSelectionConfig, timeLimit?: number) {
      this.teamSelectionActive = true
      this.teamSelectionConfig = markRaw(config) // 使用 markRaw 避免响应式代理问题
      this.teamSelectionTimeRemaining = timeLimit || 0
    },

    endTeamSelection() {
      this.teamSelectionActive = false
      this.teamSelectionConfig = null
      this.teamSelectionTimeRemaining = 0
    },

    updateTeamSelectionTimer(timeRemaining: number) {
      this.teamSelectionTimeRemaining = timeRemaining
    },

    async applyStateDelta(msg: BattleMessage) {
      // 检查消息序号，避免重复处理（除非明确跳过检查）
      if (msg.sequenceId !== undefined && msg.sequenceId <= this.lastProcessedSequenceId) {
        console.debug(`Skipping already processed message with sequenceId: ${msg.sequenceId}`)
        return
      }

      if (!this.battleState) this.battleState = {} as BattleState

      console.debug(`Applying state delta for ${msg.type} (${msg.sequenceId})`)

      try {
        const delta = msg.stateDelta
        const hasDelta = delta !== undefined && !(typeof delta === 'object' && delta !== null && Object.keys(delta).length === 0)
        if (hasDelta) {
          jsondiffpatch.patch(this.battleState, delta)
        }

        // 调试：检查 modifier 信息
        if (import.meta.env.DEV && this.battleState.players) {
          this.battleState.players.forEach(player => {
            if (player.modifierState?.hasModifiers) {
              console.debug(`Player ${player.name} has modifiers:`, player.modifierState)
            }

            player.team?.forEach(pet => {
              if (pet.modifierState?.hasModifiers) {
                console.debug(`Pet ${pet.name} has modifiers:`, pet.modifierState)
              }
            })
          })
        }

        // 在回放模式下，同步更新ReplayBattleInterface的状态
        if (
          this.isReplayMode &&
          this.battleInterface &&
          this.battleInterface instanceof ReplayBattleInterface &&
          this.battleState
        ) {
          this.battleInterface.updateState(this.battleState)
        }
      } catch (error) {
        if (isP2PPeerBattleSystem(this.battleInterface)) {
          console.debug(`Skipping incompatible p2p peer state delta for ${msg.type} (${msg.sequenceId})`, error)
        } else {
          console.warn(`Failed to apply state delta for ${msg.type} (${msg.sequenceId}):`, error)
          console.warn('StateDelta:', msg.stateDelta)
          console.warn('Current battleState:', this.battleState)
        }
        // 跳过这个有问题的消息，继续处理
      }
      // 添加时间戳并推入日志（回放模式和正常模式都需要）
      const timestampedMsg: TimestampedBattleMessage = {
        ...msg,
        receivedAt: Date.now(),
      }
      this.log.push(timestampedMsg)

      // 调试日志
      if (this.isReplayMode) {
        console.debug(`[Replay] Applied message ${msg.type} (${msg.sequenceId}), log length: ${this.log.length}`)

        // 检查状态更新后的数据
        if (msg.type === BattleMessageType.SkillUse && this.battleState?.players) {
          const playersWithPets = this.battleState.players.filter(p => p.team && p.team.length > 0)
          console.debug('[Replay] After SkillUse, players with pets:', playersWithPets.length)
          if (playersWithPets.length > 0) {
            const firstPetWithSkills = playersWithPets[0].team?.find(pet => pet.skills && pet.skills.length > 0)
            if (firstPetWithSkills) {
              console.debug('[Replay] Sample pet with skills:', {
                petId: firstPetWithSkills.id,
                petName: firstPetWithSkills.name,
                skillCount: firstPetWithSkills.skills?.length || 0,
                firstSkill: firstPetWithSkills.skills?.[0]
                  ? {
                      id: firstPetWithSkills.skills[0].id,
                      baseId: firstPetWithSkills.skills[0].baseId,
                    }
                  : null,
              })
            }
          }
        }
      }

      // 更新已处理的序号
      if (msg.sequenceId !== undefined) {
        this.lastProcessedSequenceId = Math.max(this.lastProcessedSequenceId, msg.sequenceId)
      }

      // 在回放模式下跳过交互逻辑
      if (!this.isReplayMode) {
        switch (msg.type) {
          case BattleMessageType.TurnAction:
            if (msg.data.player.includes(this.playerId as playerId)) {
              this.availableActions = await this.fetchAvailableSelection()
            }
            break

          case BattleMessageType.ForcedSwitch:
            if (msg.data.player.includes(this.playerId as playerId)) {
              this.availableActions = await this.fetchAvailableSelection()
            }
          case BattleMessageType.FaintSwitch:
            if (msg.data.player === (this.playerId as playerId)) {
              this.availableActions = await this.fetchAvailableSelection()
            }
            break
          case BattleMessageType.PetSwitch:
          case BattleMessageType.TurnStart:
            this.availableActions = []
            break
          default:
            break
        }
      }

      // 战斗结束处理（回放和正常模式都需要）
      if (msg.type === BattleMessageType.BattleEnd) {
        this.isBattleEnd = true
        this.victor = msg.data.winner

        // 战斗结束后刷新ELO数据
        this.refreshEloAfterBattle()
      }
    },

    isApplied(msg: BattleMessage): boolean {
      return this.lastProcessedSequenceId >= (msg.sequenceId ?? -1)
    },

    async handleBattleMessage(msg: BattleMessage) {
      // 处理团队选择相关消息
      if (msg.type === BattleMessageType.TeamSelectionStart) {
        // 将消息中的 config 转换为 TeamSelectionConfig 格式
        const config: TeamSelectionConfig = {
          mode: msg.data.config.mode,
          maxTeamSize: msg.data.config.maxTeamSize,
          minTeamSize: msg.data.config.minTeamSize,
          allowStarterSelection: msg.data.config.allowStarterSelection,
          showOpponentTeam: msg.data.config.showOpponentTeam,
          teamInfoVisibility: msg.data.config.teamInfoVisibility,
          timeLimit: msg.data.config.timeLimit,
        }
        this.startTeamSelection(config, msg.data.config.timeLimit)
      } else if (msg.type === BattleMessageType.TeamSelectionComplete) {
        this.endTeamSelection()
      }

      this._messageSubject.next(msg)
    },

    async resetBattle() {
      if (!this.isBattleEnd && !this.isReplayMode) {
        this.sendplayerSelection({
          player: this.playerId as playerId,
          type: 'surrender',
        })
      }

      await this._cleanupBattleResources()
    },

    // 观战者专用的重置方法，不发送surrender
    async resetBattleWithoutSurrender() {
      await this._cleanupBattleResources()
    },

    // 私有方法：清理战斗资源
    async _cleanupBattleResources() {
      // 清理战斗事件监听器
      if (this._battleEventUnsubscribe) {
        console.log('🔄 Cleaning up battle event listener during reset')
        this._battleEventUnsubscribe()
        this._battleEventUnsubscribe = null
      }

      // Clean up battle interface resources
      if (this.battleInterface) {
        try {
          await this.battleInterface.cleanup()
        } catch (error) {
          console.warn('Error during battle interface cleanup:', error)
        }
      }

      // 清理普通战斗状态
      this.battleInterface = null
      this.playerId = ''
      this.isBattleEnd = false
      this.victor = null
      this.errorMessage = null
      this.battleState = null
      // 使用响应式方式清空log数组
      this.log.splice(0, this.log.length)
      this.availableActions = []
      this.lastProcessedSequenceId = -1

      // 清理团队选择状态
      this.teamSelectionActive = false
      this.teamSelectionConfig = null
      this.teamSelectionTimeRemaining = 0

      // 清理回放模式相关状态
      this.isReplayMode = false
      this.replayMessages = []
      this.replaySnapshots = []
      this.currentSnapshotIndex = 0
      this.totalSnapshots = 0

      // 清理RxJS资源
      this._messageSubject.complete()
      this.animateQueue.complete()

      // 重新初始化RxJS Subject，以防后续使用
      this._messageSubject = new Subject<BattleMessage>()
      this.animateQueue = new Subject<() => Promise<void>>()
    },

    // 战斗结束后刷新ELO数据
    async refreshEloAfterBattle() {
      try {
        // 延迟一段时间确保后端ELO更新完成
        setTimeout(async () => {
          const playerStore = usePlayerStore()
          const eloStore = useEloStore()

          if (playerStore.id) {
            console.log('🔄 Refreshing ELO data after battle end')
            await eloStore.refreshAllElos(playerStore.id)
          }
        }, 2000) // 2秒延迟，确保后端处理完成
      } catch (error) {
        console.warn('Failed to refresh ELO data after battle:', error)
      }
    },

    getPetById(petId: string) {
      return this.battleState?.players
        ?.map(p => p.team)
        .flat()
        .find(p => p?.id === petId)
    },

    getPlayerById(playerId: playerId) {
      return this.battleState?.players?.find(p => p.id === playerId)
    },

    getSkillInfo(skillId: string) {
      return this.battleState?.players
        ?.flatMap(p => p.team)
        .flatMap(p => p?.skills)
        .find(s => s?.id === skillId)
    },

    getMarkInfo(markId: string) {
      return this.battleState?.players
        ?.flatMap(p => p.team)
        .flatMap(p => p?.marks)
        .find(m => m?.id === markId)
    },

    async fetchAvailableSelection() {
      try {
        const res = await this.battleInterface?.getAvailableSelection(this.playerId as playerId)
        return res as PlayerSelection[]
      } catch (error) {
        if (isBattleUnavailableError(error)) {
          this.waitingForResponse = false
          this.availableActions = []
          this.isBattleEnd = true
          this.errorMessage = '战斗已结束'
          return []
        }
        throw error
      }
    },

    // 回放模式相关方法
    initReplayMode(messages: BattleMessage[], _finalState: BattleState, viewerId?: string) {
      this.isReplayMode = true
      this.replayMessages = [...messages]
      this.isBattleEnd = false
      this.victor = null
      this.errorMessage = null
      // 使用响应式方式清空log数组
      this.log.splice(0, this.log.length)
      this.availableActions = []
      this.lastProcessedSequenceId = -1
      this.playerId = viewerId || ''

      // 初始化消息订阅系统（重要！）
      this._messageSubject = new Subject<BattleMessage>()
      this.animateQueue = new Subject<() => Promise<void>>()
      console.log('Initialized message subject for replay mode')

      // 创建回放专用的battleInterface，复用观战模式逻辑
      const initialState = {} as BattleState
      const replayInterface = new ReplayBattleInterface(initialState, viewerId as playerId)
      this.battleInterface = markRaw(replayInterface)

      // 注册回放模式的事件监听器
      this._battleEventUnsubscribe = (this.battleInterface.BattleEvent as BattleEventWithView)(
        msg => {
          this.handleBattleMessage(msg)
        },
        viewerId ? { viewerId: viewerId as playerId, showHidden: false } : undefined,
      )
      console.log('🔄 Registered replay battle event listener')

      // 设置玩家ID，优先使用提供的viewerId，否则使用第一个玩家的ID
      const battleStartMsg = messages.find(msg => msg.type === BattleMessageType.BattleStart)
      if (battleStartMsg && battleStartMsg.data) {
        // BattleStart 消息的 data 是空对象，从 battleState 中获取玩家信息
        this.playerId = viewerId || ''
      } else {
        this.playerId = viewerId || ''
      }

      // 设置初始空状态，模拟联机战斗的逻辑
      // 联机战斗中，battleState 一开始为空，然后通过消息的 stateDelta 逐步构建
      this.battleState = {} as BattleState

      // 生成快照数据（即使消息为空也要生成）
      this.generateReplaySnapshots()

      // 设置初始快照
      this.currentSnapshotIndex = 0
      if (this.replaySnapshots.length > 0) {
        console.log('Setting initial snapshot for replay mode:', this.replaySnapshots[0].label)
        this.setReplaySnapshot(0)
      } else {
        console.warn('No replay snapshots generated, replay mode will have limited functionality')
        // 即使没有快照，也要设置基本状态
        this.totalSnapshots = 0
      }
    },

    generateReplaySnapshots() {
      const snapshots: Array<{
        type: 'turnStart' | 'battleEnd'
        turnNumber: number
        messageIndex: number
        state: BattleState
        label: string
      }> = []

      // 如果没有消息，生成一个空的初始快照
      if (this.replayMessages.length === 0) {
        snapshots.push({
          type: 'turnStart',
          turnNumber: 1,
          messageIndex: -1,
          state: {} as BattleState,
          label: '空回放',
        })
        this.replaySnapshots = snapshots
        this.totalSnapshots = 0
        console.log('Generated empty replay snapshot for empty message list')
        return
      }

      // 模拟完整的战斗过程来生成快照
      const simulationState: BattleState = {} as BattleState

      console.debug('[Replay] Generating snapshots from', this.replayMessages.length, 'messages')

      // 模拟所有消息，在关键节点生成快照
      for (let i = 0; i < this.replayMessages.length; i++) {
        const msg = this.replayMessages[i]

        // 应用消息的状态变化（使用和applyStateDelta相同的逻辑）
        if (msg.stateDelta) {
          try {
            jsondiffpatch.patch(simulationState, msg.stateDelta)

            // 调试：检查状态更新
            if (i < 5 || msg.type === BattleMessageType.TurnStart) {
              console.debug(
                `[Replay] Applied message ${i}: ${msg.type}, players:`,
                simulationState.players?.length || 0,
              )
              if (simulationState.players && simulationState.players.length > 0) {
                const firstPlayer = simulationState.players[0]
                console.debug('[Replay] First player after message:', {
                  id: firstPlayer.id,
                  name: firstPlayer.name,
                  teamLength: firstPlayer.team?.length || 0,
                })
              }
            }
          } catch (error) {
            console.warn(
              `Failed to apply state delta during snapshot generation for ${msg.type} (${msg.sequenceId}):`,
              error,
            )
          }
        }

        // 在TurnStart消息时生成快照
        // 注意：此时simulationState已经应用了TurnStart消息的状态变化
        if (msg.type === BattleMessageType.TurnStart) {
          // 直接使用消息中的回合数，确保与战斗系统一致
          const turnNumber = msg.data.turn || 1
          snapshots.push({
            type: 'turnStart',
            turnNumber: turnNumber,
            messageIndex: i, // TurnStart消息的索引，因为状态已经包含了这个消息的变化
            state: JSON.parse(JSON.stringify(simulationState)), // 深拷贝
            label: `回合 ${turnNumber}`,
          })
        }

        // 在BattleEnd消息后生成最终快照
        if (msg.type === BattleMessageType.BattleEnd) {
          // 使用当前战斗状态中的回合数，如果没有则使用最后一个快照的回合数
          const currentTurn =
            simulationState.currentTurn || (snapshots.length > 0 ? snapshots[snapshots.length - 1].turnNumber : 1)
          snapshots.push({
            type: 'battleEnd',
            turnNumber: currentTurn,
            messageIndex: i, // BattleEnd后的状态
            state: JSON.parse(JSON.stringify(simulationState)), // 深拷贝
            label: '战斗结束',
          })
        }
      }

      this.replaySnapshots = snapshots
      this.totalSnapshots = Math.max(0, snapshots.length - 1)
      console.log(
        `Generated ${snapshots.length} replay snapshots:`,
        snapshots.map(s => s.label),
      )
    },

    setReplaySnapshot(snapshotIndex: number) {
      if (snapshotIndex < 0 || snapshotIndex >= this.replaySnapshots.length) return

      this.currentSnapshotIndex = snapshotIndex
      const snapshot = this.replaySnapshots[snapshotIndex]

      // 直接使用快照的状态
      this.battleState = JSON.parse(JSON.stringify(snapshot.state)) // 深拷贝避免修改原快照

      // 更新ReplayBattleInterface的状态
      if (this.battleInterface && this.battleInterface instanceof ReplayBattleInterface && this.battleState) {
        this.battleInterface.updateState(this.battleState)
      }

      console.debug(`Replay snapshot ${snapshotIndex} set:`, {
        snapshotLabel: snapshot.label,
        battleStateExists: !!this.battleState,
        playersCount: this.battleState?.players?.length || 0,
      })

      // 设置累积日志到当前快照位置（用于静态显示）
      // 注意：这里只是为了在不播放动画时显示正确的日志状态
      // 实际的日志更新会在播放动画时通过applyStateDelta正常处理
      const currentMessageIndex = snapshot.messageIndex
      if (currentMessageIndex >= 0) {
        const cumulativeMessages = this.replayMessages.slice(0, currentMessageIndex + 1)
        const timestampedMessages: TimestampedBattleMessage[] = cumulativeMessages.map(msg => ({
          ...msg,
          receivedAt: Date.now(),
        }))
        this.log.splice(0, this.log.length, ...timestampedMessages)
      } else {
        // 如果是初始快照，清空日志
        this.log.splice(0, this.log.length)
      }

      // 检查是否是战斗结束状态
      if (snapshot.type === 'battleEnd') {
        this.isBattleEnd = true
        // 从最后的BattleEnd消息中获取胜利者信息
        const battleEndMsg = this.replayMessages.find(msg => msg.type === BattleMessageType.BattleEnd)
        this.victor = battleEndMsg?.data?.winner || null
      } else {
        this.isBattleEnd = false
        this.victor = null
      }

      // 更新 lastProcessedSequenceId
      // 快照的 messageIndex 表示快照对应的消息索引
      // 我们需要将 lastProcessedSequenceId 设置为快照之前最后一个消息的 sequenceId
      // 这样在播放快照动画时，从快照开始的消息都能被正确处理
      if (snapshot.messageIndex >= 0) {
        // 如果快照有对应的消息，将 lastProcessedSequenceId 设置为该消息的 sequenceId
        const msg = this.replayMessages[snapshot.messageIndex]
        if (msg && msg.sequenceId !== undefined) {
          this.lastProcessedSequenceId = msg.sequenceId
        } else {
          this.lastProcessedSequenceId = -1
        }
      } else {
        // 如果是初始快照（messageIndex = -1），设置为 -1
        this.lastProcessedSequenceId = -1
      }

      console.debug(
        `Set replay snapshot ${snapshotIndex}: ${snapshot.label}, messageIndex: ${snapshot.messageIndex}, lastProcessedSequenceId: ${this.lastProcessedSequenceId}`,
      )
    },

    nextReplaySnapshot() {
      if (this.currentSnapshotIndex < this.totalSnapshots) {
        this.setReplaySnapshot(this.currentSnapshotIndex + 1)
      }
    },

    previousReplaySnapshot() {
      if (this.currentSnapshotIndex > 0) {
        this.setReplaySnapshot(this.currentSnapshotIndex - 1)
      }
    },

    exitReplayMode() {
      // resetBattle现在已经包含了所有replay状态的清理
      this.resetBattle()
    },

    // 播放快照动画（通过消息订阅系统模拟battleInterface回调）
    async playSnapshotAnimations(snapshotIndex: number) {
      if (!this.isReplayMode || snapshotIndex < 0 || snapshotIndex >= this.replaySnapshots.length) {
        return
      }

      const snapshot = this.replaySnapshots[snapshotIndex]
      const nextSnapshot = this.replaySnapshots[snapshotIndex + 1]

      // 确定要播放的消息范围
      const startIndex = Math.max(0, snapshot.messageIndex + 1)
      const endIndex = nextSnapshot ? nextSnapshot.messageIndex : this.replayMessages.length - 1
      const messagesToPlay = this.replayMessages.slice(startIndex, endIndex + 1)

      if (messagesToPlay.length === 0) {
        console.debug(`No messages to play for snapshot ${snapshotIndex}`)
        return
      }

      // 首先恢复到快照状态
      this.battleState = JSON.parse(JSON.stringify(snapshot.state))

      // 更新ReplayBattleInterface的状态
      if (this.battleInterface && this.battleInterface instanceof ReplayBattleInterface && this.battleState) {
        this.battleInterface.updateState(this.battleState)
      }

      // 重置日志到快照位置，后续消息会通过applyStateDelta正常添加
      const currentMessageIndex = snapshot.messageIndex
      if (currentMessageIndex >= 0) {
        const cumulativeMessages = this.replayMessages.slice(0, currentMessageIndex + 1)
        const timestampedMessages: TimestampedBattleMessage[] = cumulativeMessages.map(msg => ({
          ...msg,
          receivedAt: Date.now(),
        }))
        this.log.splice(0, this.log.length, ...timestampedMessages)
      } else {
        this.log.splice(0, this.log.length)
      }

      this.isBattleEnd = false
      this.victor = null

      // 设置 lastProcessedSequenceId 为快照对应的消息的 sequenceId
      // 这样后续播放的消息就能被正确处理
      if (snapshot.messageIndex >= 0 && snapshot.messageIndex < this.replayMessages.length) {
        const msg = this.replayMessages[snapshot.messageIndex]
        this.lastProcessedSequenceId = msg?.sequenceId ?? -1
      } else {
        this.lastProcessedSequenceId = -1
      }

      // 检查消息订阅是否存在
      if (!this._messageSubject || this._messageSubject.closed) {
        console.error('Message subject is not available or closed')
        return
      }

      console.debug(`Playing ${messagesToPlay.length} messages for snapshot ${snapshotIndex}: ${snapshot.label}`)

      // 通过ReplayBattleInterface触发事件，复用观战模式的消息处理逻辑
      if (this.battleInterface && this.battleInterface instanceof ReplayBattleInterface) {
        for (const message of messagesToPlay) {
          this.battleInterface.emitEvent(message)
        }
      } else {
        // 回退到直接推送消息的方式
        for (const message of messagesToPlay) {
          this._messageSubject.next(message)
        }
      }

      // 等待所有消息处理完成 - 使用事件驱动方式
      const lastMessage = messagesToPlay[messagesToPlay.length - 1]
      const targetSequenceId = lastMessage?.sequenceId ?? -1

      // 如果没有消息或者已经处理完成，立即返回
      if (messagesToPlay.length === 0 || this.lastProcessedSequenceId >= targetSequenceId) {
        return Promise.resolve()
      }

      // 简化的等待逻辑：定期检查 lastProcessedSequenceId
      return new Promise<void>(resolve => {
        let resolved = false

        const checkCompletion = () => {
          if (!resolved && this.lastProcessedSequenceId >= targetSequenceId) {
            resolved = true
            resolve()
            return
          }

          // 如果还没完成，继续检查
          if (!resolved) {
            setTimeout(checkCompletion, 100) // 每100ms检查一次
          }
        }

        // 开始检查
        checkCompletion()
      })
    },

    // 兼容性方法，将旧的回合接口映射到新的快照系统
    nextReplayTurn() {
      this.nextReplaySnapshot()
    },

    previousReplayTurn() {
      this.previousReplaySnapshot()
    },

    setReplayTurn(turnIndex: number) {
      this.setReplaySnapshot(turnIndex)
    },

    async playReplayTurnAnimations(turnIndex: number) {
      return this.playSnapshotAnimations(turnIndex)
    },

    // 开发者功能方法
    setDevPetHp(petId: string, hp: number) {
      if (!this.battleInterface || this.isReplayMode) return

      try {
        // 使用类型守卫检查开发者功能
        if (isDeveloperBattleSystem(this.battleInterface)) {
          this.battleInterface.setDevPetHp(petId, hp)
        } else {
          console.warn('开发者功能不可用：setDevPetHp')
        }
      } catch (error) {
        console.error('设置宠物血量失败:', error)
      }
    },

    setDevPlayerRage(playerId: string, rage: number) {
      if (!this.battleInterface || this.isReplayMode) return

      try {
        if (isDeveloperBattleSystem(this.battleInterface)) {
          this.battleInterface.setDevPlayerRage(playerId, rage)
        } else {
          console.warn('开发者功能不可用：setDevPlayerRage')
        }
      } catch (error) {
        console.error('设置玩家怒气失败:', error)
      }
    },

    forceAISelection(selection: PlayerSelection) {
      if (!this.battleInterface || this.isReplayMode) return

      try {
        if (isDeveloperBattleSystem(this.battleInterface)) {
          this.battleInterface.forceAISelection(selection)
        } else {
          console.warn('开发者功能不可用：forceAISelection')
        }
      } catch (error) {
        console.error('强制AI选择失败:', error)
      }
    },

    getAvailableActionsForPlayer(playerId: string) {
      if (!this.battleInterface || this.isReplayMode) return []

      try {
        if (isDeveloperBattleSystem(this.battleInterface)) {
          return this.battleInterface.getAvailableActionsForPlayer(playerId) || []
        } else {
          console.warn('开发者功能不可用：getAvailableActionsForPlayer')
          return []
        }
      } catch (error) {
        console.error('获取玩家可用操作失败:', error)
        return []
      }
    },

    async refreshCurrentPlayerActions() {
      if (!this.battleInterface || this.isReplayMode) return

      try {
        console.debug('刷新当前玩家可用操作...')
        this.availableActions = await this.fetchAvailableSelection()
        console.debug(`刷新完成，当前可用操作数量: ${this.availableActions.length}`)
      } catch (error) {
        console.error('刷新玩家可用操作失败:', error)
      }
    },
  },

  getters: {
    currentPlayer: state => {
      if (!state.battleState?.players) return undefined
      const player = state.battleState.players.find(p => p.id === state.playerId)
      if (player) return player
      // Spectator mode or player not found, assign player 1
      return state.battleState.players[0]
    },
    opponent: state => {
      if (!state.battleState?.players) return undefined
      const player = state.battleState.players.find(p => p.id === state.playerId)
      if (player) {
        return state.battleState.players.find(p => p.id !== state.playerId)
      }
      // Spectator mode or player not found, assign player 2
      return state.battleState.players[1]
    },
    // 兼容性getters，将快照系统映射到旧的回合系统接口
    currentReplayTurn: state => state.currentSnapshotIndex,
    totalReplayTurns: state => state.totalSnapshots,
    // 获取当前快照的实际回合数（用于显示）
    currentReplayTurnNumber: state => {
      if (state.replaySnapshots.length === 0 || state.currentSnapshotIndex < 0) return 1
      const snapshot = state.replaySnapshots[state.currentSnapshotIndex]
      return snapshot?.turnNumber || 1
    },
    // 获取最后一个快照的回合数（用于显示总回合数）
    totalReplayTurnNumber: state => {
      if (state.replaySnapshots.length === 0) return 1
      // 找到最后一个 turnStart 类型的快照
      const lastTurnSnapshot = state.replaySnapshots
        .slice()
        .reverse()
        .find(s => s.type === 'turnStart')
      return lastTurnSnapshot?.turnNumber || 1
    },
    // 注意：teamSelectionActive, teamSelectionConfig, teamSelectionTimeRemaining
    // 已经在 state 中定义，会自动暴露，不需要在 getters 中重复定义
  },
})
