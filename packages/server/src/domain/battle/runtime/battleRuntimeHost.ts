import type { playerId } from '@arcadia-eternity/const'
import type { IBattleSystem } from '@arcadia-eternity/interface'
import type { BattleState, PlayerSelection, PlayerTimerState, TimerConfig } from '@arcadia-eternity/const'

export type LocalBattleRoomData = {
  id: string
  battle: IBattleSystem
  battlePlayerIds: [string, string]
  players: string[]
  playersReady: Set<string>
  status: 'waiting' | 'active' | 'ended'
  lastActive: number
  battleRecordId?: string
  privateRoom?: boolean
}

export class LocalBattleRuntimeInstance {
  constructor(private readonly room: LocalBattleRoomData) {}

  get id(): string {
    return this.room.id
  }

  get battle(): IBattleSystem {
    return this.room.battle
  }

  get data(): LocalBattleRoomData {
    return this.room
  }

  get status(): LocalBattleRoomData['status'] {
    return this.room.status
  }

  set status(status: LocalBattleRoomData['status']) {
    this.room.status = status
  }

  isBattlePlayer(playerId: playerId | string): boolean {
    return this.room.battlePlayerIds.includes(playerId as string)
  }

  isReadyPlayer(playerId: string): boolean {
    return this.room.playersReady.has(playerId)
  }

  markPlayerReady(playerId: string): void {
    this.room.playersReady.add(playerId)
    this.room.lastActive = Date.now()
  }

  areAllBattlePlayersReady(): boolean {
    return this.room.battlePlayerIds.every(playerId => this.room.playersReady.has(playerId))
  }

  async submitAction(selection: PlayerSelection): Promise<void> {
    await this.room.battle.submitAction(selection)
  }

  async getState(playerId?: playerId, isSpectator?: boolean): Promise<BattleState> {
    if (playerId !== undefined) {
      return this.room.battle.getState(playerId, isSpectator)
    }
    return this.room.battle.getState()
  }

  async getAvailableSelection(playerId: playerId): Promise<ReadonlyArray<PlayerSelection>> {
    return this.room.battle.getAvailableSelection(playerId)
  }

  async ready(): Promise<void> {
    await this.room.battle.ready()
  }

  async cleanup(): Promise<void> {
    await this.room.battle.cleanup()
  }

  async isTimerEnabled(): Promise<boolean> {
    return this.room.battle.isTimerEnabled()
  }

  async getAllPlayerTimerStates(): Promise<PlayerTimerState[]> {
    return this.room.battle.getAllPlayerTimerStates()
  }

  async getTimerConfig(): Promise<TimerConfig> {
    return this.room.battle.getTimerConfig()
  }

  async startAnimation(source: string, expectedDuration: number, ownerId: playerId): Promise<string> {
    return this.room.battle.startAnimation(source, expectedDuration, ownerId)
  }

  async endAnimation(animationId: string, actualDuration?: number): Promise<void> {
    await this.room.battle.endAnimation(animationId, actualDuration)
  }

  async submitSurrenderSelection(playerId: playerId): Promise<void> {
    const selections = await this.room.battle.getAvailableSelection(playerId)
    const surrender = selections.find(selection => selection.type === 'surrender')
    if (!surrender) {
      throw new Error('SURRENDER_NOT_AVAILABLE')
    }
    await this.room.battle.submitAction(surrender)
  }

  async startReconnectGraceTimer(playerId: playerId, durationSec: number): Promise<boolean> {
    const battle = this.room.battle as IBattleSystem & {
      startReconnectGraceTimer?: (pid: playerId, seconds: number) => Promise<void>
    }
    if (typeof battle.startReconnectGraceTimer !== 'function') {
      return false
    }
    await battle.startReconnectGraceTimer(playerId, durationSec)
    return true
  }

  async cancelReconnectGraceTimer(playerId: playerId): Promise<boolean> {
    const battle = this.room.battle as IBattleSystem & {
      cancelReconnectGraceTimer?: (pid: playerId) => Promise<void>
    }
    if (typeof battle.cancelReconnectGraceTimer !== 'function') {
      return false
    }
    await battle.cancelReconnectGraceTimer(playerId)
    return true
  }
}

export interface BattleRuntimeHost {
  register(room: LocalBattleRoomData): void
  getInstance(roomId: string): LocalBattleRuntimeInstance | undefined
  getBattle(roomId: string): IBattleSystem | undefined
  getRoom(roomId: string): LocalBattleRoomData | undefined
  getAllRooms(): Map<string, LocalBattleRoomData>
  getAllBattles(): Map<string, IBattleSystem>
  listRoomIds(): string[]
  remove(roomId: string): LocalBattleRoomData | undefined
  updateRoomStatus(roomId: string, status: LocalBattleRoomData['status']): void
  isBattlePlayer(roomId: string, playerId: playerId | string): boolean
  size(): number
}

export class InMemoryBattleRuntimeHost implements BattleRuntimeHost {
  private readonly instances = new Map<string, LocalBattleRuntimeInstance>()
  private readonly battles = new Map<string, IBattleSystem>()
  private readonly rooms = new Map<string, LocalBattleRoomData>()

  register(room: LocalBattleRoomData): void {
    this.instances.set(room.id, new LocalBattleRuntimeInstance(room))
    this.rooms.set(room.id, room)
    this.battles.set(room.id, room.battle)
  }

  getInstance(roomId: string): LocalBattleRuntimeInstance | undefined {
    return this.instances.get(roomId)
  }

  getBattle(roomId: string): IBattleSystem | undefined {
    return this.battles.get(roomId)
  }

  getRoom(roomId: string): LocalBattleRoomData | undefined {
    return this.rooms.get(roomId)
  }

  getAllRooms(): Map<string, LocalBattleRoomData> {
    return new Map(this.rooms)
  }

  getAllBattles(): Map<string, IBattleSystem> {
    return new Map(this.battles)
  }

  listRoomIds(): string[] {
    return Array.from(this.rooms.keys())
  }

  remove(roomId: string): LocalBattleRoomData | undefined {
    const room = this.rooms.get(roomId)
    this.instances.delete(roomId)
    this.rooms.delete(roomId)
    this.battles.delete(roomId)
    return room
  }

  updateRoomStatus(roomId: string, status: LocalBattleRoomData['status']): void {
    const room = this.rooms.get(roomId)
    if (room) {
      room.status = status
    }
  }

  isBattlePlayer(roomId: string, playerId: playerId | string): boolean {
    const room = this.rooms.get(roomId)
    return room ? room.battlePlayerIds.includes(playerId as string) : false
  }

  size(): number {
    return this.rooms.size
  }
}
