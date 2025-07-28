import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useBattleClientStore } from './battleClient'
import { usePlayerStore } from './player'
import { usePetStorageStore } from './petStorage'
import type { PrivateRoomInfo, PrivateRoomEvent, CreatePrivateRoomRequest } from '@arcadia-eternity/protocol'
import type { PetSchemaType } from '@arcadia-eternity/schema'

export const usePrivateRoomStore = defineStore('privateRoom', () => {
  const router = useRouter()
  const battleClientStore = useBattleClientStore()
  const playerStore = usePlayerStore()
  const petStorageStore = usePetStorageStore()

  // 状态
  const currentRoom = ref<PrivateRoomInfo | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const selectedTeam = ref<PetSchemaType[]>([]) // 当前选择的队伍

  // 计算属性
  const players = computed(() => currentRoom.value?.players || [])
  const spectators = computed(() => currentRoom.value?.spectators || [])
  const isHost = computed(() => currentRoom.value?.config.hostPlayerId === playerStore.player.id)
  const isPlayer = computed(() => players.value.some(p => p.playerId === playerStore.player.id))
  const isSpectator = computed(() => spectators.value.some(s => s.playerId === playerStore.player.id))
  const myReadyStatus = computed(() => {
    const me = players.value.find(p => p.playerId === playerStore.player.id)
    return me?.isReady || false
  })
  const canStartBattle = computed(() => {
    if (!isHost.value || !currentRoom.value) return false
    if (players.value.length < 2) return false

    // 检查房主是否选择了队伍（本地检查）
    if (!selectedTeam.value || selectedTeam.value.length === 0) return false

    // 检查所有非房主玩家是否已准备
    const nonHostPlayers = players.value.filter(p => p.playerId !== currentRoom.value?.config.hostPlayerId)
    return nonHostPlayers.every(p => p.isReady)
  })

  // 方法
  const createRoom = async (config: CreatePrivateRoomRequest['config']): Promise<string> => {
    isLoading.value = true
    error.value = null

    try {
      const roomCode = await battleClientStore.createPrivateRoom({
        config,
      })

      // 获取房间信息
      await getRoomInfo(roomCode)

      // 监听房间事件
      console.log('🚨 About to call setupRoomEventListeners (createRoom)')
      setupRoomEventListeners()
      console.log('🚨 setupRoomEventListeners called (createRoom)')

      console.log('✅ Private room created:', roomCode)
      return roomCode
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      console.error('❌ Failed to create private room:', errorMessage)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const joinRoom = async (roomCode: string, password?: string): Promise<void> => {
    isLoading.value = true
    error.value = null

    try {
      await battleClientStore.joinPrivateRoom({
        roomCode,
        password,
      })

      // 获取房间信息
      await getRoomInfo(roomCode)

      // 监听房间事件
      console.log('🚨 About to call setupRoomEventListeners')
      setupRoomEventListeners()
      console.log('🚨 setupRoomEventListeners called')

      console.log('✅ Joined private room:', roomCode)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      console.error('❌ Failed to join private room:', errorMessage)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const joinAsSpectator = async (roomCode: string, preferredView?: 'player1' | 'player2' | 'god'): Promise<void> => {
    isLoading.value = true
    error.value = null

    try {
      await battleClientStore.joinPrivateRoomAsSpectator({
        roomCode,
        preferredView,
      })

      // 获取房间信息
      await getRoomInfo(roomCode)

      // 监听房间事件
      setupRoomEventListeners()

      console.log('✅ Joined as spectator in room:', roomCode)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      console.error('❌ Failed to join as spectator:', errorMessage)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const leaveRoom = async (): Promise<void> => {
    if (!currentRoom.value) return

    isLoading.value = true
    error.value = null

    try {
      await battleClientStore.leavePrivateRoom()
      cleanup()
      console.log('✅ Left private room')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      console.error('❌ Failed to leave room:', errorMessage)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const toggleReady = async (): Promise<void> => {
    if (!currentRoom.value || !isPlayer.value) return

    isLoading.value = true
    error.value = null

    try {
      // 如果要准备，使用当前选择的队伍；如果取消准备，不传队伍
      const teamToSubmit = myReadyStatus.value ? undefined : selectedTeam.value
      await battleClientStore.toggleRoomReady(teamToSubmit)
      console.log('✅ Toggled ready status')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      console.error('❌ Failed to toggle ready:', errorMessage)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const startBattle = async (): Promise<void> => {
    if (!currentRoom.value || !isHost.value) return

    // 检查房主是否选择了队伍
    if (!selectedTeam.value || selectedTeam.value.length === 0) {
      throw new Error('请先选择队伍')
    }

    isLoading.value = true
    error.value = null

    try {
      console.log('🚀 Starting battle...')

      // 发送开始战斗请求，传递房主队伍
      await battleClientStore.startRoomBattle(selectedTeam.value)

      console.log('✅ Battle start request sent, waiting for battleStarted event...')

      // 注意：不在这里跳转页面，而是等待 battleStarted 事件
      // 事件处理在 handleRoomEvent 中的 'battleStarted' case
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      console.error('❌ Failed to start battle:', errorMessage)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const resetRoom = async (): Promise<void> => {
    if (!currentRoom.value || !isHost.value) return

    isLoading.value = true
    error.value = null

    try {
      await battleClientStore.resetPrivateRoom()
      console.log('✅ Room reset for next battle')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      console.error('❌ Failed to reset room:', errorMessage)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const updateRuleSet = async (ruleSetId: string): Promise<void> => {
    if (!currentRoom.value || !isHost.value) return

    isLoading.value = true
    error.value = null

    try {
      await battleClientStore.updatePrivateRoomRuleSet({ ruleSetId })
      console.log('✅ Rule set updated to:', ruleSetId)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      console.error('❌ Failed to update rule set:', errorMessage)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const switchToSpectator = async (preferredView?: 'player1' | 'player2' | 'god'): Promise<void> => {
    if (!currentRoom.value) return

    isLoading.value = true
    error.value = null

    try {
      await battleClientStore.switchToSpectator(preferredView)
      console.log('✅ Switched to spectator')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      console.error('❌ Failed to switch to spectator:', errorMessage)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const switchToPlayer = async (team: any[]): Promise<void> => {
    if (!currentRoom.value) return

    isLoading.value = true
    error.value = null

    try {
      await battleClientStore.switchToPlayer(team)
      console.log('✅ Switched to player')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      console.error('❌ Failed to switch to player:', errorMessage)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const getRoomInfo = async (roomCode: string): Promise<void> => {
    try {
      const response = await battleClientStore.getPrivateRoomInfo(roomCode)
      currentRoom.value = response
    } catch (err) {
      console.error('❌ Failed to get room info:', err)
      throw err
    }
  }

  const setupRoomEventListeners = (): void => {
    console.log('🔧 Setting up private room event listeners...')
    console.log('🔧 BattleClient instance available:', !!battleClientStore._instance)
    console.log('🔧 BattleClient initialized:', battleClientStore.isInitialized)

    // 如果 BattleClient 还没初始化，先初始化
    if (!battleClientStore.isInitialized) {
      console.log('🔧 BattleClient not initialized, initializing now...')
      battleClientStore.initialize()
    }

    // 使用 battleClientStore 的正确方法，而不是直接操作 _instance
    battleClientStore.off('privateRoomEvent', handleRoomEvent)
    const unsubscribe = battleClientStore.on('privateRoomEvent', handleRoomEvent)

    console.log('🔧 Event listener registered, unsubscribe function:', typeof unsubscribe)
    console.log('✅ Private room event listeners set up successfully')
  }

  const handleRoomEvent = async (event: PrivateRoomEvent): Promise<void> => {
    console.log('🏠 Private room event received:', event.type, event)

    switch (event.type) {
      case 'playerJoined':
        if (currentRoom.value) {
          currentRoom.value.players.push(event.data)
        }
        break

      case 'playerLeft':
        if (currentRoom.value) {
          currentRoom.value.players = currentRoom.value.players.filter(p => p.playerId !== event.data.playerId)
        }
        break

      case 'playerReady':
        if (currentRoom.value) {
          const player = currentRoom.value.players.find(p => p.playerId === event.data.playerId)
          if (player) {
            player.isReady = event.data.isReady
          }
        }
        break

      case 'spectatorJoined':
        if (currentRoom.value) {
          currentRoom.value.spectators.push(event.data)
        }
        break

      case 'spectatorLeft':
        if (currentRoom.value) {
          currentRoom.value.spectators = currentRoom.value.spectators.filter(s => s.playerId !== event.data.playerId)
        }
        break

      case 'roomUpdate':
        console.log('🔄 Room update received:', event.data)
        console.log('📊 Current room before update:', currentRoom.value)
        currentRoom.value = event.data
        console.log('📊 Current room after update:', currentRoom.value)
        break

      case 'battleStarted':
        console.log('🎯 battleStarted event received in private room')
        try {
          if (!battleClientStore._instance) {
            throw new Error('BattleClient instance not available')
          }

          console.log('🏗️ Initializing battle system for private room')

          // 私人房间需要手动模拟 matchSuccess 的状态更新
          // 直接修改客户端状态（模拟 matchSuccess 事件的效果）
          console.log('🔄 Simulating matchSuccess state update for private room')
          const clientInstance = battleClientStore._instance as any
          if (clientInstance && clientInstance.state) {
            const oldState = { ...clientInstance.state }
            clientInstance.state = {
              ...clientInstance.state,
              matchmaking: 'matched',
              battle: 'active',
              roomId: event.data.battleRoomId,
            }
            console.log('🔄 Client state manually updated:', {
              old: oldState,
              new: clientInstance.state,
            })
          }

          // 导入必要的模块
          const { useBattleStore } = await import('./battle')
          const { RemoteBattleSystem } = await import('@arcadia-eternity/client')

          const battleStore = useBattleStore()

          // 初始化战斗系统
          await battleStore.initBattle(
            new RemoteBattleSystem(battleClientStore._instance as any),
            playerStore.player.id,
          )

          console.log('🚀 Navigating to battle page with roomId:', event.data.battleRoomId)

          // 跳转到战斗页面
          router.push({
            path: '/battle',
            query: {
              roomId: event.data.battleRoomId,
              privateRoom: 'true',
              roomCode: currentRoom.value?.config.roomCode,
            },
          })
        } catch (error) {
          console.error('❌ Failed to initialize battle for private room:', error)
          // 如果初始化失败，仍然尝试跳转，让战斗页面处理错误
          router.push({
            path: '/battle',
            query: {
              roomId: event.data.battleRoomId,
              privateRoom: 'true',
              roomCode: currentRoom.value?.config.roomCode,
            },
          })
        }
        break

      case 'battleFinished':
        // 战斗结束，返回房间页面并显示结果
        console.log('⚔️ Battle finished:', event.data.battleResult)

        // 如果当前在战斗页面，跳转回房间页面
        if (router.currentRoute.value.path === '/battle') {
          router.push(`/room/${currentRoom.value?.config.roomCode}`)
        }

        // 显示战斗结果通知
        const result = event.data.battleResult
        const winnerText = result.winner ? `玩家 ${result.winner} 获胜` : '平局'
        console.log(`🏆 战斗结果: ${winnerText} (${result.reason})`)
        break

      case 'roomReset':
        // 房间重置，显示通知
        console.log('🔄 Room reset:', event.data.message)
        break

      case 'playerSwitchedToSpectator':
        // 玩家转换为观战者
        console.log('👁️ Player switched to spectator:', event.data.playerId, 'View:', event.data.preferredView)
        break

      case 'spectatorSwitchedToPlayer':
        // 观战者转换为玩家
        console.log('🎮 Spectator switched to player:', event.data.playerId)
        break

      case 'ruleSetChanged':
        // 规则集变更
        console.log('📋 Rule set changed:', event.data.ruleSetId, 'by:', event.data.changedBy)
        // 房间信息会通过 roomUpdate 事件更新
        break

      case 'roomClosed':
        cleanup()
        // 可以显示房间关闭的通知
        console.log('🏠 Room closed:', event.data.reason)
        router.push('/')
        break
    }
  }

  // 队伍管理方法
  const updateSelectedTeam = (team: PetSchemaType[]): void => {
    selectedTeam.value = team
    // 如果已经准备了，更新队伍后自动取消准备
    if (myReadyStatus.value) {
      toggleReady().catch(err => {
        console.error('Failed to cancel ready after team update:', err)
      })
    }
  }

  const initializeSelectedTeam = (): void => {
    // 初始化时使用当前队伍
    selectedTeam.value = petStorageStore.getCurrentTeam()
  }

  // 全局状态检查方法
  const checkCurrentRoom = async (): Promise<PrivateRoomInfo | null> => {
    try {
      const roomInfo = await battleClientStore.getCurrentPrivateRoom()
      if (roomInfo) {
        currentRoom.value = roomInfo
        setupRoomEventListeners()
        initializeSelectedTeam()
      }
      return roomInfo
    } catch (err) {
      console.error('Failed to check current room:', err)
      return null
    }
  }

  // 页面离开时的清理
  const handlePageLeave = async (): Promise<void> => {
    // 如果已准备，自动取消准备
    if (myReadyStatus.value) {
      try {
        await toggleReady()
      } catch (err) {
        console.error('Failed to cancel ready on page leave:', err)
      }
    }
  }

  // 只移除事件监听器，保持房间状态
  const removeEventListeners = (): void => {
    battleClientStore.off('privateRoomEvent', handleRoomEvent)
  }

  // 完全清理房间状态（只在真正离开房间时使用）
  const cleanup = (): void => {
    currentRoom.value = null
    selectedTeam.value = []
    error.value = null
    isLoading.value = false

    // 移除事件监听器
    battleClientStore.off('privateRoomEvent', handleRoomEvent)
  }

  return {
    // 状态
    currentRoom,
    selectedTeam,
    isLoading,
    error,

    // 计算属性
    players,
    spectators,
    isHost,
    isPlayer,
    isSpectator,
    myReadyStatus,
    canStartBattle,

    // 方法
    createRoom,
    joinRoom,
    joinAsSpectator,
    leaveRoom,
    toggleReady,
    startBattle,
    resetRoom,
    updateRuleSet,
    switchToSpectator,
    switchToPlayer,
    getRoomInfo,
    setupRoomEventListeners,
    updateSelectedTeam,
    initializeSelectedTeam,
    checkCurrentRoom,
    handlePageLeave,
    removeEventListeners,
    cleanup,
  }
})
