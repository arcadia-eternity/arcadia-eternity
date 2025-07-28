import { injectable } from 'inversify'
import { nanoid } from 'nanoid'
import pino from 'pino'
import type { ClusterStateManager } from '../../../cluster/core/clusterStateManager'
import type { DistributedLockManager } from '../../../cluster/redis/distributedLock'
import type { SocketClusterAdapter } from '../../../cluster/communication/socketClusterAdapter'
import type { MatchmakingEntry } from '../../../cluster/types'
import type {
  PrivateRoom,
  PrivateRoomConfig,
  RoomPlayer,
  SpectatorEntry,
  PrivateRoomEvent,
  BattleResult,
} from '../types/PrivateRoom'
import type { SessionStateManager } from '../../session/sessionStateManager'
import type { PetSchemaType } from '@arcadia-eternity/protocol'
import { PrivateRoomError } from '../types/PrivateRoom'
import { ServerRuleIntegration } from '@arcadia-eternity/rules'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

// 私人房间战斗创建回调接口
export interface PrivateRoomBattleCallbacks {
  createClusterBattleRoom: (player1Entry: MatchmakingEntry, player2Entry: MatchmakingEntry) => Promise<string | null>
}

@injectable()
export class PrivateRoomService {
  private readonly ROOM_TTL = 24 * 60 * 60 * 1000 // 24小时
  private readonly ROOM_CLEANUP_INTERVAL = 60 * 60 * 1000 // 1小时清理一次
  private battleCallbacks?: PrivateRoomBattleCallbacks

  constructor(
    private stateManager: ClusterStateManager,
    private lockManager: DistributedLockManager,
    private socketAdapter: SocketClusterAdapter,
    private sessionStateManager: SessionStateManager,
  ) {
    // 启动房间清理定时器
    this.startRoomCleanup()
  }

  /**
   * 设置战斗创建回调
   */
  setBattleCallbacks(callbacks: PrivateRoomBattleCallbacks): void {
    this.battleCallbacks = callbacks
  }

  /**
   * 处理战斗结束
   */
  async handleBattleFinished(
    battleRoomId: string,
    battleResult: { winner: string | null; reason: string },
  ): Promise<void> {
    try {
      // 查找包含该战斗的房间
      const roomCode = await this.findRoomByBattleId(battleRoomId)
      if (!roomCode) {
        logger.warn({ battleRoomId }, 'No private room found for finished battle')
        return
      }

      await this.lockManager.withLock(`private_room:${roomCode}`, async () => {
        const room = await this.getRoom(roomCode)
        if (!room || room.battleRoomId !== battleRoomId) {
          logger.warn({ roomCode, battleRoomId }, 'Room not found or battle ID mismatch')
          return
        }

        // 创建战斗结果
        const result: BattleResult = {
          winner: battleResult.winner,
          reason: battleResult.reason,
          endedAt: Date.now(),
          battleRoomId: battleRoomId,
        }

        // 更新房间状态
        room.status = 'finished'
        room.lastBattleResult = result
        room.lastActivity = Date.now()
        // 保留 battleRoomId 用于显示结果

        // 重置所有玩家的准备状态
        room.players.forEach(player => {
          player.isReady = false
        })

        await this.saveRoom(room)

        // 广播战斗结束事件
        await this.broadcastRoomEvent(roomCode, {
          type: 'battleFinished',
          data: { battleResult: result },
        })

        logger.info(
          {
            roomCode,
            battleRoomId,
            winner: result.winner,
            reason: result.reason,
          },
          'Private room battle finished, room reset to waiting state',
        )
      })
    } catch (error) {
      logger.error({ error, battleRoomId }, 'Failed to handle battle finished')
    }
  }

  /**
   * 重置房间到等待状态（再来一局）
   */
  async resetRoomForNextBattle(roomCode: string, hostPlayerId: string): Promise<void> {
    await this.lockManager.withLock(`private_room:${roomCode}`, async () => {
      const room = await this.getRoom(roomCode)
      if (!room) {
        throw new PrivateRoomError('房间不存在', 'ROOM_NOT_FOUND')
      }

      if (room.config.hostPlayerId !== hostPlayerId) {
        throw new PrivateRoomError('只有房主可以重置房间', 'NOT_HOST')
      }

      if (room.status !== 'finished') {
        throw new PrivateRoomError('房间状态不正确', 'INVALID_STATE')
      }

      // 重置房间状态
      room.status = 'waiting'
      room.battleRoomId = undefined
      room.lastActivity = Date.now()
      // 保留 lastBattleResult 用于显示历史

      // 重置所有玩家的准备状态
      room.players.forEach(player => {
        player.isReady = false
      })

      await this.saveRoom(room)

      // 广播房间重置事件
      await this.broadcastRoomEvent(roomCode, {
        type: 'roomReset',
        data: { message: '房间已重置，可以开始新的战斗' },
      })

      logger.info(
        {
          roomCode,
          hostPlayerId,
          playersCount: room.players.length,
        },
        'Private room reset for next battle',
      )
    })
  }

  /**
   * 创建私人房间
   */
  async createRoom(hostEntry: RoomPlayer, config: Partial<PrivateRoomConfig>): Promise<string> {
    const roomCode = this.generateRoomCode()

    return await this.lockManager.withLock(`private_room:${roomCode}`, async () => {
      // 检查房主的当前 session 是否已在其他房间
      const existingRoom = await this.findPlayerSessionRoom(hostEntry.playerId, hostEntry.sessionId)
      if (existingRoom) {
        throw new PrivateRoomError('该会话已在其他房间中', 'ALREADY_IN_ROOM')
      }

      const room: PrivateRoom = {
        id: nanoid(),
        config: {
          roomCode,
          hostPlayerId: hostEntry.playerId,
          ruleSetId: config.ruleSetId || 'casual_standard_ruleset',
          maxPlayers: 2,
          maxSpectators: config.maxSpectators || 10,
          allowSpectators: config.allowSpectators || false,
          spectatorMode: config.spectatorMode || 'free',
          isPrivate: config.isPrivate || false,
          password: config.password,
        },
        players: [hostEntry],
        spectators: [],
        status: 'waiting',
        createdAt: Date.now(),
        lastActivity: Date.now(),
      }

      await this.saveRoom(room)
      await this.addPlayerSessionToRoom(hostEntry.playerId, hostEntry.sessionId, roomCode)

      logger.info(
        {
          roomCode,
          hostPlayerId: hostEntry.playerId,
          config: room.config,
        },
        'Private room created',
      )

      return roomCode
    })
  }

  /**
   * 加入房间
   */
  async joinRoom(request: { roomCode: string; password?: string }, playerEntry: RoomPlayer): Promise<boolean> {
    // 检查 session 状态，确保不与匹配队列冲突
    const stateCheck = await this.sessionStateManager.canEnterPrivateRoom(playerEntry.playerId, playerEntry.sessionId)
    if (!stateCheck.allowed) {
      throw new PrivateRoomError(stateCheck.reason || '无法加入房间', 'INVALID_STATE')
    }

    return await this.lockManager.withLock(`private_room:${request.roomCode}`, async () => {
      const room = await this.getRoom(request.roomCode)
      if (!room) {
        throw new PrivateRoomError('房间不存在', 'ROOM_NOT_FOUND')
      }

      if (room.status !== 'waiting') {
        throw new PrivateRoomError('房间状态不允许加入', 'INVALID_STATE')
      }

      // 检查密码
      if (room.config.isPrivate && room.config.password !== request.password) {
        throw new PrivateRoomError('房间密码错误', 'INVALID_PASSWORD')
      }

      // 检查房间是否已满
      if (room.players.length >= room.config.maxPlayers) {
        throw new PrivateRoomError('房间已满', 'ROOM_FULL')
      }

      // 检查该 session 是否已在房间中
      if (room.players.some(p => p.playerId === playerEntry.playerId && p.sessionId === playerEntry.sessionId)) {
        throw new PrivateRoomError('该会话已在房间中', 'ALREADY_IN_ROOM')
      }

      // 检查该 session 是否在其他房间
      const existingRoom = await this.findPlayerSessionRoom(playerEntry.playerId, playerEntry.sessionId)
      if (existingRoom && existingRoom !== request.roomCode) {
        throw new PrivateRoomError('该会话已在其他房间中', 'ALREADY_IN_ROOM')
      }

      room.players.push(playerEntry)
      room.lastActivity = Date.now()

      await this.saveRoom(room)
      await this.addPlayerSessionToRoom(playerEntry.playerId, playerEntry.sessionId, request.roomCode)

      // 设置 session 状态为私人房间
      await this.sessionStateManager.setSessionState(playerEntry.playerId, playerEntry.sessionId, 'private_room', {
        roomCode: request.roomCode,
      })

      // 广播玩家加入事件
      await this.broadcastRoomEvent(request.roomCode, {
        type: 'playerJoined',
        data: playerEntry,
      })

      // 广播房间状态更新
      await this.broadcastRoomEvent(request.roomCode, {
        type: 'roomUpdate',
        data: room,
      })

      logger.info(
        {
          roomCode: request.roomCode,
          playerId: playerEntry.playerId,
          playerCount: room.players.length,
        },
        'Player joined private room',
      )

      return true
    })
  }

  /**
   * 观战者加入房间
   */
  async joinAsSpectator(
    request: { roomCode: string; preferredView?: 'player1' | 'player2' | 'god' },
    spectatorEntry: SpectatorEntry,
  ): Promise<boolean> {
    // 检查 session 状态，确保不与匹配队列冲突
    const stateCheck = await this.sessionStateManager.canEnterPrivateRoom(
      spectatorEntry.playerId,
      spectatorEntry.sessionId,
    )
    if (!stateCheck.allowed) {
      throw new PrivateRoomError(stateCheck.reason || '无法加入房间', 'INVALID_STATE')
    }

    return await this.lockManager.withLock(`private_room:${request.roomCode}`, async () => {
      const room = await this.getRoom(request.roomCode)
      if (!room) {
        throw new PrivateRoomError('房间不存在', 'ROOM_NOT_FOUND')
      }

      if (!room.config.allowSpectators) {
        throw new PrivateRoomError('房间不允许观战', 'INVALID_STATE')
      }

      if (room.spectators.length >= room.config.maxSpectators) {
        throw new PrivateRoomError('观战席已满', 'ROOM_FULL')
      }

      // 检查是否已在观战列表中
      if (room.spectators.some(s => s.playerId === spectatorEntry.playerId)) {
        throw new PrivateRoomError('已在观战列表中', 'ALREADY_IN_ROOM')
      }

      spectatorEntry.preferredView = request.preferredView
      room.spectators.push(spectatorEntry)
      room.lastActivity = Date.now()

      await this.saveRoom(room)

      // 设置 session 状态为私人房间
      await this.sessionStateManager.setSessionState(
        spectatorEntry.playerId,
        spectatorEntry.sessionId,
        'private_room',
        {
          roomCode: request.roomCode,
        },
      )

      // 广播观战者加入事件
      await this.broadcastRoomEvent(request.roomCode, {
        type: 'spectatorJoined',
        data: spectatorEntry,
      })

      // 广播房间状态更新
      await this.broadcastRoomEvent(request.roomCode, {
        type: 'roomUpdate',
        data: room,
      })

      logger.info(
        {
          roomCode: request.roomCode,
          playerId: spectatorEntry.playerId,
          spectatorCount: room.spectators.length,
        },
        'Spectator joined private room',
      )

      return true
    })
  }

  /**
   * 玩家离开房间（基于 session）
   */
  async leaveRoom(roomCode: string, playerId: string, sessionId: string): Promise<void> {
    await this.lockManager.withLock(`private_room:${roomCode}`, async () => {
      const room = await this.getRoom(roomCode)
      if (!room) return

      const wasHost = room.config.hostPlayerId === playerId

      // 移除特定 session 的玩家
      room.players = room.players.filter(p => !(p.playerId === playerId && p.sessionId === sessionId))
      room.spectators = room.spectators.filter(s => !(s.playerId === playerId && s.sessionId === sessionId))
      await this.removePlayerSessionFromRoom(playerId, sessionId)

      // 清除 session 状态
      await this.sessionStateManager.clearSessionState(playerId, sessionId)

      if (wasHost || room.players.length === 0) {
        // 房主离开或房间为空，解散房间
        await this.closeRoom(roomCode, '房主离开或房间为空')
      } else {
        // 更新房间状态
        room.lastActivity = Date.now()
        await this.saveRoom(room)

        // 广播玩家离开事件
        await this.broadcastRoomEvent(roomCode, {
          type: 'playerLeft',
          data: { playerId },
        })

        // 广播房间状态更新
        await this.broadcastRoomEvent(roomCode, {
          type: 'roomUpdate',
          data: room,
        })
      }

      logger.info(
        {
          roomCode,
          playerId,
          wasHost,
          remainingPlayers: room.players.length,
        },
        'Player left private room',
      )
    })
  }

  /**
   * 移除玩家的所有 session（用于踢出玩家等管理操作）
   */
  async removePlayerAllSessions(roomCode: string, playerId: string): Promise<void> {
    await this.lockManager.withLock(`private_room:${roomCode}`, async () => {
      const room = await this.getRoom(roomCode)
      if (!room) return

      const wasHost = room.config.hostPlayerId === playerId

      // 获取该玩家的所有 session
      const playerSessions = room.players.filter(p => p.playerId === playerId).map(p => p.sessionId)
      const spectatorSessions = room.spectators.filter(s => s.playerId === playerId).map(s => s.sessionId)

      // 移除该玩家的所有 session
      room.players = room.players.filter(p => p.playerId !== playerId)
      room.spectators = room.spectators.filter(s => s.playerId !== playerId)

      // 移除所有相关的 session 映射
      for (const sessionId of [...playerSessions, ...spectatorSessions]) {
        await this.removePlayerSessionFromRoom(playerId, sessionId)
      }

      if (wasHost || room.players.length === 0) {
        // 房主离开或房间为空，解散房间
        await this.closeRoom(roomCode, '房主离开或房间为空')
      } else {
        // 更新房间状态
        room.lastActivity = Date.now()
        await this.saveRoom(room)

        // 广播玩家离开事件
        await this.broadcastRoomEvent(roomCode, {
          type: 'playerLeft',
          data: { playerId },
        })
      }

      logger.info(
        {
          roomCode,
          playerId,
          wasHost,
          removedSessions: [...playerSessions, ...spectatorSessions],
          remainingPlayers: room.players.length,
        },
        'Player all sessions removed from private room',
      )
    })
  }

  /**
   * 切换玩家准备状态
   */
  async togglePlayerReady(roomCode: string, playerId: string, team?: PetSchemaType[]): Promise<void> {
    await this.lockManager.withLock(`private_room:${roomCode}`, async () => {
      const room = await this.getRoom(roomCode)
      if (!room) {
        throw new PrivateRoomError('房间不存在', 'ROOM_NOT_FOUND')
      }

      const player = room.players.find(p => p.playerId === playerId)
      if (!player) {
        throw new PrivateRoomError('玩家不在房间中', 'ROOM_NOT_FOUND')
      }

      // 房主也可以设置队伍，但不需要准备状态
      const isHost = playerId === room.config.hostPlayerId

      // 如果提供了队伍，设置队伍（房主和普通玩家都可以）
      if (team) {
        // 验证队伍数据
        if (!team || team.length === 0) {
          throw new PrivateRoomError('队伍数据不能为空', 'INVALID_TEAM')
        }

        // 验证队伍是否符合当前规则集
        try {
          const validation = await ServerRuleIntegration.validateTeamWithRuleSet(team, room.config.ruleSetId)
          if (!validation.isValid) {
            const errorMessage = validation.errors.map(error => error.message).join('; ')
            throw new PrivateRoomError(`队伍不符合当前规则集要求：${errorMessage}`, 'TEAM_VALIDATION_FAILED', {
              errors: validation.errors,
              ruleSetId: room.config.ruleSetId,
            })
          }
        } catch (error) {
          if (error instanceof PrivateRoomError) {
            throw error
          }
          logger.error({ error, playerId, ruleSetId: room.config.ruleSetId }, 'Failed to validate team with rule set')
          throw new PrivateRoomError('队伍验证失败', 'TEAM_VALIDATION_FAILED')
        }

        player.team = team
      }

      // 房主不需要准备状态，只设置队伍
      if (isHost) {
        // 房主只设置队伍，不改变准备状态
        return
      }

      // 普通玩家的准备状态切换
      // 如果取消准备，清除队伍数据
      if (player.isReady && !team) {
        player.team = undefined
      }

      player.isReady = !player.isReady
      room.lastActivity = Date.now()

      await this.saveRoom(room)

      // 广播准备状态变化
      await this.broadcastRoomEvent(roomCode, {
        type: 'playerReady',
        data: { playerId, isReady: player.isReady },
      })

      // 广播房间状态更新
      await this.broadcastRoomEvent(roomCode, {
        type: 'roomUpdate',
        data: room,
      })

      logger.info(
        {
          roomCode,
          playerId,
          isReady: player.isReady,
        },
        'Player ready status changed',
      )
    })
  }

  /**
   * 更新房间规则集（仅房主可操作）
   */
  async updateRuleSet(roomCode: string, hostPlayerId: string, ruleSetId: string): Promise<void> {
    await this.lockManager.withLock(`private_room:${roomCode}`, async () => {
      const room = await this.getRoom(roomCode)
      if (!room) {
        throw new PrivateRoomError('房间不存在', 'ROOM_NOT_FOUND')
      }

      // 检查是否为房主
      if (room.config.hostPlayerId !== hostPlayerId) {
        throw new PrivateRoomError('只有房主可以更改规则集', 'NOT_HOST')
      }

      // 检查房间状态
      if (room.status !== 'waiting') {
        throw new PrivateRoomError('只能在等待状态下更改规则集', 'INVALID_STATE')
      }

      // 验证规则集是否存在（这里可以添加更严格的验证）
      if (!ruleSetId || ruleSetId.trim() === '') {
        throw new PrivateRoomError('规则集ID不能为空', 'INVALID_RULESET')
      }

      // 更新规则集
      const oldRuleSetId = room.config.ruleSetId
      room.config.ruleSetId = ruleSetId
      room.lastActivity = Date.now()

      // 重置所有非房主玩家的准备状态
      room.players.forEach(player => {
        if (player.playerId !== hostPlayerId) {
          player.isReady = false
        }
      })

      await this.saveRoom(room)

      // 广播规则集变更事件
      await this.broadcastRoomEvent(roomCode, {
        type: 'ruleSetChanged',
        data: { ruleSetId, changedBy: hostPlayerId },
      })

      // 广播房间状态更新
      await this.broadcastRoomEvent(roomCode, {
        type: 'roomUpdate',
        data: room,
      })

      logger.info(
        {
          roomCode,
          hostPlayerId,
          oldRuleSetId,
          newRuleSetId: ruleSetId,
        },
        'Room rule set updated',
      )
    })
  }

  /**
   * 更新房间配置（仅房主可操作）
   */
  async updateRoomConfig(
    roomCode: string,
    hostPlayerId: string,
    configUpdates: {
      ruleSetId?: string
      allowSpectators?: boolean
      maxSpectators?: number
      spectatorMode?: 'free' | 'player1' | 'player2' | 'god'
      isPrivate?: boolean
      password?: string
    },
  ): Promise<void> {
    await this.lockManager.withLock(`private_room:${roomCode}`, async () => {
      const room = await this.getRoom(roomCode)
      if (!room) {
        throw new PrivateRoomError('房间不存在', 'ROOM_NOT_FOUND')
      }

      // 检查是否为房主
      if (room.config.hostPlayerId !== hostPlayerId) {
        throw new PrivateRoomError('只有房主可以更改房间配置', 'NOT_HOST')
      }

      // 检查房间状态
      if (room.status !== 'waiting') {
        throw new PrivateRoomError('只能在等待状态下更改房间配置', 'INVALID_STATE')
      }

      const oldConfig = { ...room.config }
      let needsPlayerReadyReset = false

      // 更新规则集
      if (configUpdates.ruleSetId !== undefined) {
        if (!configUpdates.ruleSetId || configUpdates.ruleSetId.trim() === '') {
          throw new PrivateRoomError('规则集ID不能为空', 'INVALID_RULESET')
        }
        room.config.ruleSetId = configUpdates.ruleSetId
        needsPlayerReadyReset = true
      }

      // 更新观战设置
      if (configUpdates.allowSpectators !== undefined) {
        room.config.allowSpectators = configUpdates.allowSpectators

        // 如果禁用观战，需要移除所有观战者
        if (!configUpdates.allowSpectators && room.spectators.length > 0) {
          // 广播观战者被移除的事件
          for (const spectator of room.spectators) {
            await this.broadcastRoomEvent(roomCode, {
              type: 'spectatorLeft',
              data: spectator,
            })
          }
          room.spectators = []
        }
      }

      if (configUpdates.maxSpectators !== undefined) {
        if (configUpdates.maxSpectators < 1 || configUpdates.maxSpectators > 50) {
          throw new PrivateRoomError('观战者数量必须在1-50之间', 'INVALID_CONFIG')
        }
        room.config.maxSpectators = configUpdates.maxSpectators

        // 如果当前观战者数量超过新限制，移除多余的观战者
        if (room.spectators.length > configUpdates.maxSpectators) {
          const removedSpectators = room.spectators.splice(configUpdates.maxSpectators)
          for (const spectator of removedSpectators) {
            await this.broadcastRoomEvent(roomCode, {
              type: 'spectatorLeft',
              data: spectator,
            })
          }
        }
      }

      if (configUpdates.spectatorMode !== undefined) {
        room.config.spectatorMode = configUpdates.spectatorMode
      }

      // 更新隐私设置
      if (configUpdates.isPrivate !== undefined) {
        room.config.isPrivate = configUpdates.isPrivate

        // 如果设置为私密房间但没有密码，抛出错误
        if (configUpdates.isPrivate && !configUpdates.password && !room.config.password) {
          throw new PrivateRoomError('私密房间必须设置密码', 'INVALID_CONFIG')
        }

        // 如果设置为公开房间，清除密码
        if (!configUpdates.isPrivate) {
          room.config.password = undefined
        }
      }

      if (configUpdates.password !== undefined) {
        if (room.config.isPrivate && (!configUpdates.password || configUpdates.password.trim() === '')) {
          throw new PrivateRoomError('私密房间密码不能为空', 'INVALID_CONFIG')
        }
        room.config.password = configUpdates.password || undefined
      }

      room.lastActivity = Date.now()

      // 如果规则集发生变化，重置所有非房主玩家的准备状态
      if (needsPlayerReadyReset) {
        room.players.forEach(player => {
          if (player.playerId !== hostPlayerId) {
            player.isReady = false
          }
        })
      }

      await this.saveRoom(room)

      // 广播房间配置变更事件
      await this.broadcastRoomEvent(roomCode, {
        type: 'roomConfigChanged',
        data: {
          oldConfig,
          newConfig: room.config,
          changedBy: hostPlayerId,
        },
      })

      // 广播房间状态更新
      await this.broadcastRoomEvent(roomCode, {
        type: 'roomUpdate',
        data: room,
      })

      logger.info(
        {
          roomCode,
          hostPlayerId,
          configUpdates,
          oldConfig,
          newConfig: room.config,
        },
        'Room configuration updated',
      )
    })
  }

  /**
   * 获取房间信息
   */
  async getRoom(roomCode: string): Promise<PrivateRoom | null> {
    try {
      const client = this.stateManager.redisManager.getClient()
      const roomData = await client.get(`private_room:${roomCode}`)
      if (!roomData) return null
      return JSON.parse(roomData) as PrivateRoom
    } catch (error) {
      logger.error({ error, roomCode }, 'Failed to get private room')
      return null
    }
  }

  /**
   * 生成房间码
   */
  private generateRoomCode(): string {
    // 生成6位大写字母数字组合
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let result = ''
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  /**
   * 保存房间到Redis
   */
  private async saveRoom(room: PrivateRoom): Promise<void> {
    const client = this.stateManager.redisManager.getClient()
    await client.setex(`private_room:${room.config.roomCode}`, Math.floor(this.ROOM_TTL / 1000), JSON.stringify(room))
  }

  /**
   * 添加玩家到房间映射（基于 session）
   */
  private async addPlayerSessionToRoom(playerId: string, sessionId: string, roomCode: string): Promise<void> {
    const client = this.stateManager.redisManager.getClient()
    const sessionKey = `private_room_player:${playerId}:${sessionId}`
    await client.setex(sessionKey, Math.floor(this.ROOM_TTL / 1000), roomCode)

    // 同时维护玩家的所有 session 列表，用于查询和清理
    const playerSessionsKey = `private_room_player_sessions:${playerId}`
    await client.sadd(playerSessionsKey, sessionId)
    await client.expire(playerSessionsKey, Math.floor(this.ROOM_TTL / 1000))
  }

  /**
   * 移除玩家房间映射（基于 session）
   */
  private async removePlayerSessionFromRoom(playerId: string, sessionId: string): Promise<void> {
    const client = this.stateManager.redisManager.getClient()
    const sessionKey = `private_room_player:${playerId}:${sessionId}`
    await client.del(sessionKey)

    // 从玩家 session 列表中移除
    const playerSessionsKey = `private_room_player_sessions:${playerId}`
    await client.srem(playerSessionsKey, sessionId)
  }

  /**
   * 查找玩家特定 session 所在房间
   */
  private async findPlayerSessionRoom(playerId: string, sessionId: string): Promise<string | null> {
    try {
      const client = this.stateManager.redisManager.getClient()
      const sessionKey = `private_room_player:${playerId}:${sessionId}`
      return await client.get(sessionKey)
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Failed to find player session room')
      return null
    }
  }

  /**
   * 根据战斗房间ID查找私人房间
   */
  private async findRoomByBattleId(battleRoomId: string): Promise<string | null> {
    try {
      const client = this.stateManager.redisManager.getClient()

      // 扫描所有私人房间，查找匹配的战斗ID
      const keys = await client.keys('private_room:*')

      for (const key of keys) {
        const roomData = await client.get(key)
        if (roomData) {
          const room: PrivateRoom = JSON.parse(roomData)
          if (room.battleRoomId === battleRoomId) {
            return room.config.roomCode
          }
        }
      }

      return null
    } catch (error) {
      logger.error({ error, battleRoomId }, 'Failed to find room by battle ID')
      return null
    }
  }

  /**
   * 获取玩家所有 session 所在的房间
   */
  private async findPlayerAllSessionRooms(playerId: string): Promise<{ sessionId: string; roomCode: string }[]> {
    try {
      const client = this.stateManager.redisManager.getClient()
      const playerSessionsKey = `private_room_player_sessions:${playerId}`
      const sessionIds = await client.smembers(playerSessionsKey)

      const results: { sessionId: string; roomCode: string }[] = []

      for (const sessionId of sessionIds) {
        const sessionKey = `private_room_player:${playerId}:${sessionId}`
        const roomCode = await client.get(sessionKey)
        if (roomCode) {
          results.push({ sessionId, roomCode })
        }
      }

      return results
    } catch (error) {
      logger.error({ error, playerId }, 'Failed to find player all session rooms')
      return []
    }
  }

  /**
   * 广播房间事件
   */
  private async broadcastRoomEvent(roomCode: string, event: PrivateRoomEvent): Promise<void> {
    try {
      // 使用 Redis 发布订阅来广播私人房间事件
      const client = this.stateManager.redisManager.getPublisher()
      const channel = `private_room_events:${roomCode}`

      const message = {
        roomCode,
        event,
        timestamp: Date.now(),
      }

      await client.publish(channel, JSON.stringify(message))

      logger.debug({ roomCode, event }, 'Private room event broadcasted')
    } catch (error) {
      logger.error({ error, roomCode, event }, 'Failed to broadcast room event')
    }
  }

  /**
   * 关闭房间
   */
  private async closeRoom(roomCode: string, reason: string): Promise<void> {
    const room = await this.getRoom(roomCode)
    if (!room) return

    // 移除所有玩家的 session 映射
    for (const player of room.players) {
      await this.removePlayerSessionFromRoom(player.playerId, player.sessionId)
    }

    // 移除所有观战者的 session 映射
    for (const spectator of room.spectators) {
      await this.removePlayerSessionFromRoom(spectator.playerId, spectator.sessionId)
    }

    // 广播房间关闭事件
    await this.broadcastRoomEvent(roomCode, {
      type: 'roomClosed',
      data: { reason },
    })

    // 删除房间数据
    const client = this.stateManager.redisManager.getClient()
    await client.del(`private_room:${roomCode}`)

    logger.info({ roomCode, reason }, 'Private room closed')
  }

  /**
   * 启动房间清理定时器
   */
  private startRoomCleanup(): void {
    setInterval(async () => {
      try {
        await this.cleanupExpiredRooms()
      } catch (error) {
        logger.error({ error }, 'Failed to cleanup expired rooms')
      }
    }, this.ROOM_CLEANUP_INTERVAL)
  }

  /**
   * 清理过期房间
   */
  private async cleanupExpiredRooms(): Promise<void> {
    // 这里可以实现更复杂的清理逻辑
    // 由于使用了Redis的TTL，大部分清理工作会自动完成
    logger.debug('Room cleanup task executed')
  }

  /**
   * 检查房间是否可以开始战斗
   */
  async canStartBattle(roomCode: string, hostPlayerId: string): Promise<boolean> {
    const room = await this.getRoom(roomCode)
    if (!room) return false

    // 检查是否为房主
    if (room.config.hostPlayerId !== hostPlayerId) return false

    // 检查房间状态
    if (room.status !== 'waiting') return false

    // 检查玩家数量
    if (room.players.length < 2) return false

    // 检查所有非房主玩家是否已准备
    const nonHostPlayers = room.players.filter(p => p.playerId !== hostPlayerId)
    return nonHostPlayers.every(p => p.isReady)
  }

  /**
   * 验证房间内所有队伍是否符合当前规则集
   */
  async validateTeamsWithRuleSet(room: PrivateRoom): Promise<{ isValid: boolean; errors: string[] }> {
    const errors: string[] = []

    for (const player of room.players) {
      // 只验证已准备且有队伍的玩家
      if (!player.isReady || !player.team) {
        continue
      }

      try {
        const validation = await ServerRuleIntegration.validateTeamWithRuleSet(player.team, room.config.ruleSetId)
        if (!validation.isValid) {
          const playerErrors = validation.errors.map(error => `玩家 ${player.playerName}: ${error.message}`)
          errors.push(...playerErrors)
        }
      } catch (error) {
        logger.error(
          { error, playerId: player.playerId, ruleSetId: room.config.ruleSetId },
          'Failed to validate team with rule set',
        )
        errors.push(`玩家 ${player.playerName}: 队伍验证失败`)
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
  }

  /**
   * 开始战斗
   */
  async startBattle(roomCode: string, hostPlayerId: string, hostTeam: PetSchemaType[]): Promise<string | null> {
    return await this.lockManager.withLock(`private_room:${roomCode}`, async () => {
      const canStart = await this.canStartBattle(roomCode, hostPlayerId)
      if (!canStart) {
        throw new PrivateRoomError('无法开始战斗', 'INVALID_STATE')
      }

      const room = await this.getRoom(roomCode)
      if (!room) {
        throw new PrivateRoomError('房间不存在', 'ROOM_NOT_FOUND')
      }

      if (room.players.length < 2) {
        throw new PrivateRoomError('玩家数量不足', 'INVALID_STATE')
      }

      // 设置房主队伍
      const hostPlayer = room.players.find(p => p.playerId === hostPlayerId)
      if (!hostPlayer) {
        throw new PrivateRoomError('房主不在房间中', 'INVALID_STATE')
      }

      // 验证房主队伍
      if (!hostTeam || hostTeam.length === 0) {
        throw new PrivateRoomError('房主队伍不能为空', 'INVALID_TEAM')
      }

      try {
        const validation = await ServerRuleIntegration.validateTeamWithRuleSet(hostTeam, room.config.ruleSetId)
        if (!validation.isValid) {
          const errorMessage = validation.errors.map(error => error.message).join('; ')
          throw new PrivateRoomError(`房主队伍不符合当前规则集要求：${errorMessage}`, 'TEAM_VALIDATION_FAILED', {
            errors: validation.errors,
            ruleSetId: room.config.ruleSetId,
          })
        }
      } catch (error) {
        if (error instanceof PrivateRoomError) {
          throw error
        }
        logger.error(
          { error, hostPlayerId, ruleSetId: room.config.ruleSetId },
          'Failed to validate host team with rule set',
        )
        throw new PrivateRoomError('房主队伍验证失败', 'TEAM_VALIDATION_FAILED')
      }

      // 设置房主队伍
      hostPlayer.team = hostTeam

      // 检查所有玩家是否都有队伍
      const allPlayersHaveTeam = room.players.every(player => player.team && player.team.length > 0)
      if (!allPlayersHaveTeam) {
        throw new PrivateRoomError('还有玩家未设置队伍', 'INVALID_STATE')
      }

      // 验证所有队伍是否符合当前规则集
      const teamValidation = await this.validateTeamsWithRuleSet(room)
      if (!teamValidation.isValid) {
        throw new PrivateRoomError(
          `队伍不符合当前规则集要求：${teamValidation.errors.join('; ')}`,
          'TEAM_VALIDATION_FAILED',
          { errors: teamValidation.errors, ruleSetId: room.config.ruleSetId },
        )
      }

      // 检查是否有战斗创建回调
      if (!this.battleCallbacks) {
        throw new PrivateRoomError('战斗系统未初始化', 'INVALID_STATE')
      }

      // 将房间玩家转换为 MatchmakingEntry 格式
      const player1 = room.players[0]
      const player2 = room.players[1]

      const player1Entry: MatchmakingEntry = {
        playerId: player1.playerId,
        joinTime: player1.joinedAt,
        playerData: {
          id: player1.playerId,
          name: player1.playerName,
          team: player1.team!, // 已验证不为空
        },
        sessionId: player1.sessionId,
        ruleSetId: room.config.ruleSetId,
        metadata: {
          sessionId: player1.sessionId,
          ruleSetId: room.config.ruleSetId,
          privateRoom: true,
          roomCode: roomCode,
        },
      }

      const player2Entry: MatchmakingEntry = {
        playerId: player2.playerId,
        joinTime: player2.joinedAt,
        playerData: {
          id: player2.playerId,
          name: player2.playerName,
          team: player2.team!, // 已验证不为空
        },
        sessionId: player2.sessionId,
        ruleSetId: room.config.ruleSetId,
        metadata: {
          sessionId: player2.sessionId,
          ruleSetId: room.config.ruleSetId,
          privateRoom: true,
          roomCode: roomCode,
        },
      }

      // 调用战斗系统创建战斗房间
      const battleRoomId = await this.battleCallbacks.createClusterBattleRoom(player1Entry, player2Entry)

      if (!battleRoomId) {
        throw new PrivateRoomError('创建战斗房间失败', 'INVALID_STATE')
      }

      // 更新房间状态
      room.status = 'started'
      room.lastActivity = Date.now()
      room.battleRoomId = battleRoomId

      await this.saveRoom(room)

      // 广播战斗开始事件
      await this.broadcastRoomEvent(roomCode, {
        type: 'battleStarted',
        data: { battleRoomId },
      })

      logger.info(
        {
          roomCode,
          battleRoomId,
          players: room.players.map(p => ({ id: p.playerId, name: p.playerName })),
          ruleSetId: room.config.ruleSetId,
        },
        'Private room battle started successfully',
      )

      return battleRoomId
    })
  }

  /**
   * 获取房间列表（用于调试和管理）
   */
  async getRoomList(): Promise<PrivateRoom[]> {
    try {
      const client = this.stateManager.redisManager.getClient()
      const keys = await client.keys('private_room:*')
      const rooms: PrivateRoom[] = []

      for (const key of keys) {
        const roomData = await client.get(key)
        if (roomData) {
          try {
            rooms.push(JSON.parse(roomData) as PrivateRoom)
          } catch (error) {
            logger.warn({ key, error }, 'Failed to parse room data')
          }
        }
      }

      return rooms
    } catch (error) {
      logger.error({ error }, 'Failed to get room list')
      return []
    }
  }

  /**
   * 更新房间活跃时间
   */
  async updateRoomActivity(roomCode: string): Promise<void> {
    const room = await this.getRoom(roomCode)
    if (room) {
      room.lastActivity = Date.now()
      await this.saveRoom(room)
    }
  }

  /**
   * 获取玩家特定 session 当前所在房间
   */
  async getPlayerSessionCurrentRoom(playerId: string, sessionId: string): Promise<PrivateRoom | null> {
    const roomCode = await this.findPlayerSessionRoom(playerId, sessionId)
    if (!roomCode) return null
    return await this.getRoom(roomCode)
  }

  /**
   * 获取玩家当前所在房间（返回第一个找到的房间）
   * 建议使用 getPlayerSessionCurrentRoom 替代以获得更精确的结果
   */
  async getPlayerCurrentRoom(playerId: string): Promise<PrivateRoom | null> {
    // 基于 session 的查找，返回第一个找到的房间
    const sessionRooms = await this.findPlayerAllSessionRooms(playerId)
    if (sessionRooms.length > 0) {
      return await this.getRoom(sessionRooms[0].roomCode)
    }

    return null
  }

  /**
   * 玩家转换为观战者
   */
  async switchToSpectator(
    roomCode: string,
    playerId: string,
    sessionId: string,
    preferredView?: 'player1' | 'player2' | 'god',
  ): Promise<void> {
    await this.lockManager.withLock(`private_room:${roomCode}`, async () => {
      const room = await this.getRoom(roomCode)
      if (!room) {
        throw new PrivateRoomError('房间不存在', 'ROOM_NOT_FOUND')
      }

      if (room.status !== 'waiting') {
        throw new PrivateRoomError('只能在等待状态下转换角色', 'INVALID_STATE')
      }

      // 查找该玩家
      const playerIndex = room.players.findIndex(p => p.playerId === playerId && p.sessionId === sessionId)
      if (playerIndex === -1) {
        throw new PrivateRoomError('玩家不在房间中', 'PLAYER_NOT_FOUND')
      }

      const player = room.players[playerIndex]

      // 检查是否是房主
      if (room.config.hostPlayerId === playerId) {
        throw new PrivateRoomError('房主不能转换为观战者', 'HOST_CANNOT_SPECTATE')
      }

      // 检查观战者数量限制
      if (room.spectators.length >= room.config.maxSpectators) {
        throw new PrivateRoomError('观战者数量已达上限', 'SPECTATOR_LIMIT_REACHED')
      }

      // 从玩家列表中移除
      room.players.splice(playerIndex, 1)

      // 添加到观战者列表
      const spectatorEntry: SpectatorEntry = {
        playerId: player.playerId,
        playerName: player.playerName,
        sessionId: player.sessionId,
        joinedAt: Date.now(),
        preferredView: preferredView || 'god',
      }
      room.spectators.push(spectatorEntry)

      room.lastActivity = Date.now()
      await this.saveRoom(room)

      // 广播角色转换事件
      await this.broadcastRoomEvent(roomCode, {
        type: 'playerSwitchedToSpectator',
        data: { playerId, preferredView: spectatorEntry.preferredView as string },
      })

      // 广播房间状态更新
      await this.broadcastRoomEvent(roomCode, {
        type: 'roomUpdate',
        data: room,
      })

      logger.info(
        {
          roomCode,
          playerId,
          sessionId,
          preferredView: spectatorEntry.preferredView,
        },
        'Player switched to spectator',
      )
    })
  }

  /**
   * 观战者转换为玩家
   */
  async switchToPlayer(roomCode: string, playerId: string, sessionId: string, team: PetSchemaType[]): Promise<void> {
    await this.lockManager.withLock(`private_room:${roomCode}`, async () => {
      const room = await this.getRoom(roomCode)
      if (!room) {
        throw new PrivateRoomError('房间不存在', 'ROOM_NOT_FOUND')
      }

      if (room.status !== 'waiting') {
        throw new PrivateRoomError('只能在等待状态下转换角色', 'INVALID_STATE')
      }

      // 查找该观战者
      const spectatorIndex = room.spectators.findIndex(s => s.playerId === playerId && s.sessionId === sessionId)
      if (spectatorIndex === -1) {
        throw new PrivateRoomError('观战者不在房间中', 'SPECTATOR_NOT_FOUND')
      }

      const spectator = room.spectators[spectatorIndex]

      // 检查玩家数量限制（最多2个玩家）
      if (room.players.length >= 2) {
        throw new PrivateRoomError('玩家数量已达上限', 'PLAYER_LIMIT_REACHED')
      }

      // 验证队伍数据
      if (!team || team.length === 0) {
        throw new PrivateRoomError('队伍数据不能为空', 'INVALID_TEAM')
      }

      // 从观战者列表中移除
      room.spectators.splice(spectatorIndex, 1)

      // 添加到玩家列表
      const playerEntry: RoomPlayer = {
        playerId: spectator.playerId,
        playerName: spectator.playerName,
        sessionId: spectator.sessionId,
        team: team,
        isReady: false,
        joinedAt: Date.now(),
      }
      room.players.push(playerEntry)

      room.lastActivity = Date.now()
      await this.saveRoom(room)

      // 广播角色转换事件
      await this.broadcastRoomEvent(roomCode, {
        type: 'spectatorSwitchedToPlayer',
        data: { playerId },
      })

      // 广播房间状态更新
      await this.broadcastRoomEvent(roomCode, {
        type: 'roomUpdate',
        data: room,
      })

      logger.info(
        {
          roomCode,
          playerId,
          sessionId,
          teamSize: team.length,
        },
        'Spectator switched to player',
      )
    })
  }
}
