import type {
  BattleState,
  PlayerSelection,
  BattleMessage,
  playerId,
  PlayerTimerState,
  TimerConfig,
  Events,
} from '@arcadia-eternity/const'
import { SelectionParser } from '@arcadia-eternity/parser'
import type { IBattleSystem } from '@arcadia-eternity/interface'
import type { BattleClient } from './client'

export class RemoteBattleSystem implements IBattleSystem {
  constructor(private client: BattleClient) {}

  async getState(): Promise<BattleState> {
    return this.client.getBattleState()
  }

  async getAvailableSelection(): Promise<PlayerSelection[]> {
    return (await this.client.getAvailableSelection()).map(s => SelectionParser.parse(s))
  }

  async submitAction(selection: PlayerSelection): Promise<void> {
    return this.client.sendplayerSelection(SelectionParser.serialize(selection))
  }

  BattleEvent(callback: (message: BattleMessage) => void): () => void {
    const unsubscribe = this.client.on('battleEvent', callback)
    return () => unsubscribe()
  }

  async ready(): Promise<void> {
    await this.client.ready()
  }

  // 计时器相关方法实现
  async isTimerEnabled(): Promise<boolean> {
    // 通过客户端获取计时器状态
    return this.client.isTimerEnabled()
  }

  async getPlayerTimerState(playerId: playerId): Promise<PlayerTimerState | null> {
    return this.client.getPlayerTimerState(playerId)
  }

  async getAllPlayerTimerStates(): Promise<PlayerTimerState[]> {
    return this.client.getAllPlayerTimerStates()
  }

  async getTimerConfig(): Promise<TimerConfig> {
    return this.client.getTimerConfig()
  }

  async startAnimation(source: string, expectedDuration: number, ownerId: playerId): Promise<string> {
    return this.client.startAnimation(source, expectedDuration, ownerId)
  }

  async endAnimation(animationId: string, actualDuration?: number): Promise<void> {
    return this.client.endAnimation(animationId, actualDuration)
  }

  // 计时器事件监听方法
  onTimerEvent<K extends keyof Events>(eventType: K, handler: (data: Events[K]) => void): () => void {
    return this.client.onTimerEvent(eventType, handler)
  }

  offTimerEvent<K extends keyof Events>(eventType: K, handler: (data: Events[K]) => void): void {
    this.client.offTimerEvent(eventType, handler)
  }

  /**
   * Clean up all resources and subscriptions associated with this battle system
   */
  async cleanup(): Promise<void> {
    // For remote battle system, we typically don't need to clean up much
    // as the server handles the battle lifecycle
    // But we can clean up any client-side resources if needed
    console.log('RemoteBattleSystem cleanup completed')
  }
}
