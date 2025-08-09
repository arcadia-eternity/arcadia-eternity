import type { Socket } from 'socket.io'
import pino from 'pino'
import type { PrivateRoomService } from '../services/privateRoomService'
import type { SocketClusterAdapter } from '../../../cluster/communication/socketClusterAdapter'
import type {
  CreatePrivateRoomRequest,
  JoinPrivateRoomRequest,
  JoinPrivateRoomSpectatorRequest,
  UpdatePrivateRoomRuleSetRequest,
  UpdatePrivateRoomConfigRequest,
  TogglePrivateRoomReadyRequest,
  StartPrivateRoomBattleRequest,
  TransferPrivateRoomHostRequest,
  KickPlayerFromPrivateRoomRequest,
  AckResponse,
  PrivateRoomInfo,
} from '@arcadia-eternity/protocol'
import type { RoomPlayer, SpectatorEntry, PrivateRoomError } from '../types/PrivateRoom'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

interface SocketData {
  playerId?: string
  sessionId?: string
  data?: {
    name?: string
  }
}

export class PrivateRoomHandlers {
  constructor(
    private roomService: PrivateRoomService,
    private socketAdapter: SocketClusterAdapter,
  ) {}

  /**
   * 处理创建私人房间请求
   */
  async handleCreateRoom(
    socket: Socket<any, any, any, SocketData>,
    data: CreatePrivateRoomRequest,
    ack?: AckResponse<{ roomCode: string }>,
  ) {
    try {
      const playerId = socket.data?.playerId
      const sessionId = socket.data?.sessionId
      const playerName = socket.data?.data?.name || `Player_${playerId?.slice(0, 8)}`

      if (!playerId || !sessionId) {
        ack?.({ status: 'ERROR', code: 'AUTHENTICATION_REQUIRED', details: '需要认证' })
        return
      }

      // 检查该 session 是否已在其他房间
      const existingRoom = await this.roomService.getPlayerSessionCurrentRoom(playerId, sessionId)
      if (existingRoom) {
        ack?.({ status: 'ERROR', code: 'ALREADY_IN_ROOM', details: '该会话已在其他房间中' })
        return
      }

      const hostEntry: RoomPlayer = {
        playerId,
        playerName,
        sessionId,
        isReady: false,
        joinedAt: Date.now(),
        connectionStatus: 'online',
      }

      const roomCode = await this.roomService.createRoom(hostEntry, data.config)

      // 将Socket加入房间组
      socket.join(`private_room:${roomCode}`)

      logger.info(
        {
          roomCode,
          playerId,
          playerName,
          config: data.config,
        },
        'Private room created successfully',
      )

      ack?.({ status: 'SUCCESS', data: { roomCode } })
    } catch (error) {
      logger.error({ error, playerId: socket.data?.playerId }, 'Failed to create private room')

      if (error instanceof Error && error.name === 'PrivateRoomError') {
        const roomError = error as PrivateRoomError
        ack?.({ status: 'ERROR', code: roomError.code, details: roomError.message })
      } else {
        ack?.({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '创建房间失败' })
      }
    }
  }

  /**
   * 处理加入私人房间请求
   */
  async handleJoinRoom(
    socket: Socket<any, any, any, SocketData>,
    data: JoinPrivateRoomRequest,
    ack?: AckResponse<{ status: 'JOINED' }>,
  ) {
    try {
      const playerId = socket.data?.playerId
      const sessionId = socket.data?.sessionId
      const playerName = socket.data?.data?.name || `Player_${playerId?.slice(0, 8)}`

      if (!playerId || !sessionId) {
        ack?.({ status: 'ERROR', code: 'AUTHENTICATION_REQUIRED', details: '需要认证' })
        return
      }

      const playerEntry: RoomPlayer = {
        playerId,
        playerName,
        sessionId,
        isReady: false,
        joinedAt: Date.now(),
        connectionStatus: 'online',
      }

      const success = await this.roomService.joinRoom(data, playerEntry, 'player')

      if (success) {
        // 将Socket加入房间组
        socket.join(`private_room:${data.roomCode}`)

        logger.info(
          {
            roomCode: data.roomCode,
            playerId,
            playerName,
          },
          'Player joined private room successfully',
        )

        ack?.({ status: 'SUCCESS', data: { status: 'JOINED' } })
      } else {
        ack?.({ status: 'ERROR', code: 'JOIN_FAILED', details: '加入房间失败' })
      }
    } catch (error) {
      logger.error({ error, playerId: socket.data?.playerId }, 'Failed to join private room')

      if (error instanceof Error && error.name === 'PrivateRoomError') {
        const roomError = error as PrivateRoomError
        ack?.({ status: 'ERROR', code: roomError.code, details: roomError.message })
      } else {
        ack?.({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '加入房间失败' })
      }
    }
  }

  /**
   * 处理观战者加入请求
   */
  async handleJoinAsSpectator(
    socket: Socket<any, any, any, SocketData>,
    data: JoinPrivateRoomSpectatorRequest,
    ack?: AckResponse<{ status: 'JOINED' }>,
  ) {
    try {
      const playerId = socket.data?.playerId
      const sessionId = socket.data?.sessionId
      const playerName = socket.data?.data?.name || `Spectator_${playerId?.slice(0, 8)}`

      if (!playerId || !sessionId) {
        ack?.({ status: 'ERROR', code: 'AUTHENTICATION_REQUIRED', details: '需要认证' })
        return
      }

      const spectatorEntry: SpectatorEntry = {
        playerId,
        playerName,
        sessionId,
        joinedAt: Date.now(),
        connectionStatus: 'online',
      }

      const success = await this.roomService.joinRoom({ roomCode: data.roomCode }, spectatorEntry, 'spectator')

      if (success) {
        // 将Socket加入房间组
        socket.join(`private_room:${data.roomCode}`)

        logger.info(
          {
            roomCode: data.roomCode,
            playerId,
            playerName,
          },
          'Spectator joined private room successfully',
        )

        ack?.({ status: 'SUCCESS', data: { status: 'JOINED' } })
      } else {
        ack?.({ status: 'ERROR', code: 'JOIN_FAILED', details: '加入观战失败' })
      }
    } catch (error) {
      logger.error({ error, playerId: socket.data?.playerId }, 'Failed to join as spectator')

      if (error instanceof Error && error.name === 'PrivateRoomError') {
        const roomError = error as PrivateRoomError
        ack?.({ status: 'ERROR', code: roomError.code, details: roomError.message })
      } else {
        ack?.({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '加入观战失败' })
      }
    }
  }

  /**
   * 处理离开房间请求
   */
  async handleLeaveRoom(socket: Socket<any, any, any, SocketData>, ack?: AckResponse<{ status: 'LEFT' }>) {
    try {
      const playerId = socket.data?.playerId
      const sessionId = socket.data?.sessionId

      if (!playerId || !sessionId) {
        ack?.({ status: 'ERROR', code: 'AUTHENTICATION_REQUIRED', details: '需要认证' })
        return
      }

      // 获取该 session 当前所在房间
      const currentRoom = await this.roomService.getPlayerSessionCurrentRoom(playerId, sessionId)
      if (!currentRoom) {
        ack?.({ status: 'ERROR', code: 'NOT_IN_ROOM', details: '该会话不在任何房间中' })
        return
      }

      await this.roomService.leaveRoom(currentRoom.config.roomCode, playerId, sessionId)

      // 离开Socket房间组
      socket.leave(`private_room:${currentRoom.config.roomCode}`)

      logger.info(
        {
          roomCode: currentRoom.config.roomCode,
          playerId,
        },
        'Player left private room successfully',
      )

      ack?.({ status: 'SUCCESS', data: { status: 'LEFT' } })
    } catch (error) {
      logger.error({ error, playerId: socket.data?.playerId }, 'Failed to leave private room')
      ack?.({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '离开房间失败' })
    }
  }

  /**
   * 处理切换准备状态请求
   */
  async handleToggleReady(
    socket: Socket<any, any, any, SocketData>,
    data: TogglePrivateRoomReadyRequest,
    ack?: AckResponse<{ status: 'READY_TOGGLED' }>,
  ) {
    try {
      const playerId = socket.data?.playerId
      const sessionId = socket.data?.sessionId

      if (!playerId || !sessionId) {
        ack?.({ status: 'ERROR', code: 'AUTHENTICATION_REQUIRED', details: '需要认证' })
        return
      }

      // 获取该 session 当前所在房间
      const currentRoom = await this.roomService.getPlayerSessionCurrentRoom(playerId, sessionId)
      if (!currentRoom) {
        ack?.({ status: 'ERROR', code: 'NOT_IN_ROOM', details: '该会话不在任何房间中' })
        return
      }

      await this.roomService.togglePlayerReady(currentRoom.config.roomCode, playerId, data.team)

      logger.info(
        {
          roomCode: currentRoom.config.roomCode,
          playerId,
        },
        'Player ready status toggled successfully',
      )

      ack?.({ status: 'SUCCESS', data: { status: 'READY_TOGGLED' } })
    } catch (error) {
      logger.error({ error, playerId: socket.data?.playerId }, 'Failed to toggle ready status')

      if (error instanceof Error && error.name === 'PrivateRoomError') {
        const roomError = error as PrivateRoomError
        ack?.({ status: 'ERROR', code: roomError.code, details: roomError.message })
      } else {
        ack?.({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '切换准备状态失败' })
      }
    }
  }

  /**
   * 处理开始战斗请求
   */
  async handleStartBattle(
    socket: Socket<any, any, any, SocketData>,
    data: StartPrivateRoomBattleRequest,
    ack?: AckResponse<{ battleRoomId: string }>,
  ) {
    try {
      const playerId = socket.data?.playerId
      const sessionId = socket.data?.sessionId

      if (!playerId || !sessionId) {
        ack?.({ status: 'ERROR', code: 'AUTHENTICATION_REQUIRED', details: '需要认证' })
        return
      }

      // 获取该 session 当前所在房间
      const currentRoom = await this.roomService.getPlayerSessionCurrentRoom(playerId, sessionId)
      if (!currentRoom) {
        ack?.({ status: 'ERROR', code: 'NOT_IN_ROOM', details: '该会话不在任何房间中' })
        return
      }

      const battleRoomId = await this.roomService.startBattle(currentRoom.config.roomCode, playerId, data.hostTeam)

      if (battleRoomId) {
        logger.info(
          {
            roomCode: currentRoom.config.roomCode,
            battleRoomId,
            playerId,
          },
          'Private room battle started successfully',
        )

        ack?.({ status: 'SUCCESS', data: { battleRoomId } })
      } else {
        ack?.({ status: 'ERROR', code: 'START_BATTLE_FAILED', details: '开始战斗失败' })
      }
    } catch (error) {
      logger.error({ error, playerId: socket.data?.playerId }, 'Failed to start battle')

      if (error instanceof Error && error.name === 'PrivateRoomError') {
        const roomError = error as PrivateRoomError
        ack?.({ status: 'ERROR', code: roomError.code, details: roomError.message })
      } else {
        ack?.({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '开始战斗失败' })
      }
    }
  }

  /**
   * 处理获取房间信息请求
   */
  async handleGetRoomInfo(
    socket: Socket<any, any, any, SocketData>,
    data: { roomCode: string },
    ack?: AckResponse<PrivateRoomInfo>,
  ) {
    try {
      const room = await this.roomService.getRoom(data.roomCode)

      if (!room) {
        ack?.({ status: 'ERROR', code: 'ROOM_NOT_FOUND', details: '房间不存在' })
        return
      }

      // 转换为协议格式
      const roomInfo: PrivateRoomInfo = {
        id: room.id,
        config: {
          roomCode: room.config.roomCode,
          hostPlayerId: room.config.hostPlayerId,
          ruleSetId: room.config.ruleSetId,
          maxPlayers: room.config.maxPlayers,
          isPrivate: room.config.isPrivate,
          password: room.config.password,
        },
        players: room.players,
        spectators: room.spectators,
        status: room.status,
        createdAt: room.createdAt,
        lastActivity: room.lastActivity,
        battleRoomId: room.battleRoomId,
      }

      ack?.({ status: 'SUCCESS', data: roomInfo })
    } catch (error) {
      logger.error({ error, roomCode: data.roomCode }, 'Failed to get room info')
      ack?.({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '获取房间信息失败' })
    }
  }

  /**
   * 处理转移房主请求
   */
  async handleTransferHost(
    socket: Socket<any, any, any, SocketData>,
    data: TransferPrivateRoomHostRequest,
    ack?: AckResponse<{ status: 'TRANSFERRED' }>,
  ) {
    try {
      const playerId = socket.data?.playerId
      const sessionId = socket.data?.sessionId

      if (!playerId || !sessionId) {
        ack?.({ status: 'ERROR', code: 'AUTHENTICATION_REQUIRED', details: '需要认证' })
        return
      }

      // 获取该 session 当前所在房间
      const currentRoom = await this.roomService.getPlayerSessionCurrentRoom(playerId, sessionId)
      if (!currentRoom) {
        ack?.({ status: 'ERROR', code: 'NOT_IN_ROOM', details: '该会话不在任何房间中' })
        return
      }

      await this.roomService.transferHost(currentRoom.config.roomCode, playerId, data.targetPlayerId)

      logger.info(
        {
          roomCode: currentRoom.config.roomCode,
          currentHostId: playerId,
          targetPlayerId: data.targetPlayerId,
        },
        'Host transferred successfully',
      )

      ack?.({ status: 'SUCCESS', data: { status: 'TRANSFERRED' } })
    } catch (error) {
      logger.error({ error, playerId: socket.data?.playerId }, 'Failed to transfer host')

      if (error instanceof Error && error.name === 'PrivateRoomError') {
        const roomError = error as PrivateRoomError
        ack?.({ status: 'ERROR', code: roomError.code, details: roomError.message })
      } else {
        ack?.({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '转移房主失败' })
      }
    }
  }

  /**
   * 处理踢出玩家请求
   */
  async handleKickPlayer(
    socket: Socket<any, any, any, SocketData>,
    data: KickPlayerFromPrivateRoomRequest,
    ack?: AckResponse<{ status: 'KICKED' }>,
  ) {
    try {
      const playerId = socket.data?.playerId
      const sessionId = socket.data?.sessionId

      if (!playerId || !sessionId) {
        ack?.({ status: 'ERROR', code: 'AUTHENTICATION_REQUIRED', details: '需要认证' })
        return
      }

      // 获取该 session 当前所在房间
      const currentRoom = await this.roomService.getPlayerSessionCurrentRoom(playerId, sessionId)
      if (!currentRoom) {
        ack?.({ status: 'ERROR', code: 'NOT_IN_ROOM', details: '该会话不在任何房间中' })
        return
      }

      await this.roomService.kickPlayer(currentRoom.config.roomCode, playerId, data.targetPlayerId)

      logger.info(
        {
          roomCode: currentRoom.config.roomCode,
          hostId: playerId,
          targetPlayerId: data.targetPlayerId,
        },
        'Player kicked successfully',
      )

      ack?.({ status: 'SUCCESS', data: { status: 'KICKED' } })
    } catch (error) {
      logger.error({ error, playerId: socket.data?.playerId }, 'Failed to kick player')

      if (error instanceof Error && error.name === 'PrivateRoomError') {
        const roomError = error as PrivateRoomError
        ack?.({ status: 'ERROR', code: roomError.code, details: roomError.message })
      } else {
        ack?.({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '踢出玩家失败' })
      }
    }
  }

  /**
   * 处理玩家转换为观战者请求
   */
  async handleSwitchToSpectator(
    socket: Socket<any, any, any, SocketData>,
    data: {},
    ack?: AckResponse<{ status: 'SWITCHED' }>,
  ) {
    try {
      const playerId = socket.data?.playerId
      const sessionId = socket.data?.sessionId

      if (!playerId || !sessionId) {
        ack?.({ status: 'ERROR', code: 'AUTHENTICATION_REQUIRED', details: '需要认证' })
        return
      }

      // 获取该 session 当前所在房间
      const currentRoom = await this.roomService.getPlayerSessionCurrentRoom(playerId, sessionId)
      if (!currentRoom) {
        ack?.({ status: 'ERROR', code: 'NOT_IN_ROOM', details: '该会话不在任何房间中' })
        return
      }

      await this.roomService.switchToSpectator(currentRoom.config.roomCode, playerId, sessionId)

      logger.info(
        {
          roomCode: currentRoom.config.roomCode,
          playerId,
        },
        'Player switched to spectator successfully',
      )

      ack?.({ status: 'SUCCESS', data: { status: 'SWITCHED' } })
    } catch (error) {
      logger.error({ error, playerId: socket.data?.playerId }, 'Failed to switch to spectator')

      if (error instanceof Error && error.name === 'PrivateRoomError') {
        const roomError = error as PrivateRoomError
        ack?.({ status: 'ERROR', code: roomError.code, details: roomError.message })
      } else {
        ack?.({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '转换为观战者失败' })
      }
    }
  }

  /**
   * 处理观战者转换为玩家请求
   */
  async handleSwitchToPlayer(
    socket: Socket<any, any, any, SocketData>,
    data: { team: any[] },
    ack?: AckResponse<{ status: 'SWITCHED' }>,
  ) {
    try {
      const playerId = socket.data?.playerId
      const sessionId = socket.data?.sessionId

      if (!playerId || !sessionId) {
        ack?.({ status: 'ERROR', code: 'AUTHENTICATION_REQUIRED', details: '需要认证' })
        return
      }

      // 获取该 session 当前所在房间
      const currentRoom = await this.roomService.getPlayerSessionCurrentRoom(playerId, sessionId)
      if (!currentRoom) {
        ack?.({ status: 'ERROR', code: 'NOT_IN_ROOM', details: '该会话不在任何房间中' })
        return
      }

      await this.roomService.switchToPlayer(currentRoom.config.roomCode, playerId, sessionId, data.team)

      logger.info(
        {
          roomCode: currentRoom.config.roomCode,
          playerId,
          teamSize: data.team.length,
        },
        'Spectator switched to player successfully',
      )

      ack?.({ status: 'SUCCESS', data: { status: 'SWITCHED' } })
    } catch (error) {
      logger.error({ error, playerId: socket.data?.playerId }, 'Failed to switch to player')

      if (error instanceof Error && error.name === 'PrivateRoomError') {
        const roomError = error as PrivateRoomError
        ack?.({ status: 'ERROR', code: roomError.code, details: roomError.message })
      } else {
        ack?.({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '转换为玩家失败' })
      }
    }
  }

  /**
   * 处理更新房间规则集请求
   */
  async handleUpdateRuleSet(
    socket: Socket<any, any, any, SocketData>,
    data: UpdatePrivateRoomRuleSetRequest,
    ack?: AckResponse<{ status: 'UPDATED' }>,
  ) {
    try {
      const playerId = socket.data?.playerId
      const sessionId = socket.data?.sessionId

      if (!playerId || !sessionId) {
        ack?.({ status: 'ERROR', code: 'AUTHENTICATION_REQUIRED', details: '需要认证' })
        return
      }

      // 获取该 session 当前所在房间
      const currentRoom = await this.roomService.getPlayerSessionCurrentRoom(playerId, sessionId)
      if (!currentRoom) {
        ack?.({ status: 'ERROR', code: 'NOT_IN_ROOM', details: '该会话不在任何房间中' })
        return
      }

      await this.roomService.updateRuleSet(currentRoom.config.roomCode, playerId, data.ruleSetId)

      logger.info(
        {
          roomCode: currentRoom.config.roomCode,
          playerId,
          ruleSetId: data.ruleSetId,
        },
        'Private room rule set updated successfully',
      )

      ack?.({ status: 'SUCCESS', data: { status: 'UPDATED' } })
    } catch (error) {
      logger.error({ error, playerId: socket.data?.playerId }, 'Failed to update private room rule set')

      if (error instanceof Error && error.name === 'PrivateRoomError') {
        const roomError = error as PrivateRoomError
        ack?.({ status: 'ERROR', code: roomError.code, details: roomError.message })
      } else {
        ack?.({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '更新规则集失败' })
      }
    }
  }

  /**
   * 处理更新房间配置请求
   */
  async handleUpdateRoomConfig(
    socket: Socket<any, any, any, SocketData>,
    data: UpdatePrivateRoomConfigRequest,
    ack?: AckResponse<{ status: 'UPDATED' }>,
  ) {
    try {
      const playerId = socket.data?.playerId
      const sessionId = socket.data?.sessionId

      if (!playerId || !sessionId) {
        ack?.({ status: 'ERROR', code: 'AUTHENTICATION_REQUIRED', details: '需要认证' })
        return
      }

      // 获取该 session 当前所在房间
      const currentRoom = await this.roomService.getPlayerSessionCurrentRoom(playerId, sessionId)
      if (!currentRoom) {
        ack?.({ status: 'ERROR', code: 'NOT_IN_ROOM', details: '该会话不在任何房间中' })
        return
      }

      await this.roomService.updateRoomConfig(currentRoom.config.roomCode, playerId, data)

      logger.info(
        {
          roomCode: currentRoom.config.roomCode,
          playerId,
          configUpdates: data,
        },
        'Private room configuration updated successfully',
      )

      ack?.({ status: 'SUCCESS', data: { status: 'UPDATED' } })
    } catch (error) {
      logger.error({ error, playerId: socket.data?.playerId }, 'Failed to update private room configuration')

      if (error instanceof Error && error.name === 'PrivateRoomError') {
        const roomError = error as PrivateRoomError
        ack?.({ status: 'ERROR', code: roomError.code, details: roomError.message })
      } else {
        ack?.({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '更新房间配置失败' })
      }
    }
  }

  /**
   * 处理获取当前房间请求
   */
  async handleGetCurrentRoom(socket: Socket<any, any, any, SocketData>, ack?: AckResponse<PrivateRoomInfo | null>) {
    try {
      const playerId = socket.data?.playerId
      const sessionId = socket.data?.sessionId

      if (!playerId || !sessionId) {
        ack?.({ status: 'ERROR', code: 'AUTHENTICATION_REQUIRED', details: '需要认证' })
        return
      }

      // 获取该 session 当前所在房间
      const currentRoom = await this.roomService.getPlayerSessionCurrentRoom(playerId, sessionId)
      if (!currentRoom) {
        ack?.({ status: 'SUCCESS', data: null })
        return
      }

      // 转换为协议格式
      const roomInfo: PrivateRoomInfo = {
        id: currentRoom.id,
        config: {
          roomCode: currentRoom.config.roomCode,
          hostPlayerId: currentRoom.config.hostPlayerId,
          ruleSetId: currentRoom.config.ruleSetId,
          maxPlayers: currentRoom.config.maxPlayers,
          isPrivate: currentRoom.config.isPrivate,
          password: currentRoom.config.password,
        },
        players: currentRoom.players,
        spectators: currentRoom.spectators,
        status: currentRoom.status,
        createdAt: currentRoom.createdAt,
        lastActivity: currentRoom.lastActivity,
        battleRoomId: currentRoom.battleRoomId,
        lastBattleResult: currentRoom.lastBattleResult,
      }

      logger.info(
        {
          roomCode: currentRoom.config.roomCode,
          playerId,
        },
        'Current room retrieved successfully',
      )

      ack?.({ status: 'SUCCESS', data: roomInfo })
    } catch (error) {
      logger.error({ error, playerId: socket.data?.playerId }, 'Failed to get current room')
      ack?.({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '获取当前房间失败' })
    }
  }

  /**
   * 处理中途加入观战请求
   */
  async handleJoinSpectateBattle(
    socket: Socket<any, any, any, SocketData>,
    data: { battleRoomId: string },
    ack?: AckResponse<{ status: 'SPECTATING' }>,
  ) {
    try {
      const playerId = socket.data?.playerId
      const sessionId = socket.data?.sessionId

      if (!playerId || !sessionId) {
        ack?.({ status: 'ERROR', code: 'AUTHENTICATION_REQUIRED', details: '需要认证' })
        return
      }

      // 这里需要一个方法来调用 battleService 的 joinSpectateBattle
      // 我们假设在 roomService 中添加一个代理方法
      const success = await this.roomService.joinSpectateBattle(data.battleRoomId, { playerId, sessionId })

      if (success) {
        logger.info(
          {
            battleRoomId: data.battleRoomId,
            playerId,
          },
          'Player started spectating battle successfully',
        )
        ack?.({ status: 'SUCCESS', data: { status: 'SPECTATING' } })
      } else {
        ack?.({ status: 'ERROR', code: 'JOIN_FAILED', details: '加入观战失败' })
      }
    } catch (error) {
      logger.error({ error, playerId: socket.data?.playerId }, 'Failed to join spectate battle')
      if (error instanceof Error && error.name === 'PrivateRoomError') {
        const roomError = error as PrivateRoomError
        ack?.({ status: 'ERROR', code: roomError.code, details: roomError.message })
      } else {
        ack?.({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '加入观战失败' })
      }
    }
  }

  /**
   * 处理离开观战请求
   */
  async handleLeaveSpectateBattle(
    socket: Socket<any, any, any, SocketData>,
    data: {},
    ack?: AckResponse<{ status: 'LEFT_SPECTATE' }>,
  ) {
    try {
      const playerId = socket.data?.playerId
      const sessionId = socket.data?.sessionId

      if (!playerId || !sessionId) {
        ack?.({ status: 'ERROR', code: 'AUTHENTICATION_REQUIRED', details: '需要认证' })
        return
      }

      // 直接调用 battleService 来移除观战者
      // 需要通过 roomService 访问 battleCallbacks
      await this.roomService.leaveSpectateBattle(playerId, sessionId)

      logger.info(
        {
          playerId,
          sessionId,
        },
        'Player left spectate battle successfully',
      )
      ack?.({ status: 'SUCCESS', data: { status: 'LEFT_SPECTATE' } })
    } catch (error) {
      logger.error({ error, playerId: socket.data?.playerId }, 'Failed to leave spectate battle')
      if (error instanceof Error && error.name === 'PrivateRoomError') {
        const roomError = error as PrivateRoomError
        ack?.({ status: 'ERROR', code: roomError.code, details: roomError.message })
      } else {
        ack?.({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '离开观战失败' })
      }
    }
  }
}
