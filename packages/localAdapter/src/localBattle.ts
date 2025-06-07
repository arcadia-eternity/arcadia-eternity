import type { IBattleSystem } from '@arcadia-eternity/interface'
import { Battle } from '@arcadia-eternity/battle'
import type {
  BattleMessage,
  BattleState,
  playerId,
  PlayerSelection,
  PlayerTimerState,
  TimerConfig,
  Events,
} from '@arcadia-eternity/const'

export class LocalBattleSystem implements IBattleSystem {
  private battleStarted: boolean = false
  private battlePromise?: Promise<void>
  private isCleanedUp: boolean = false

  constructor(private battle: Battle) {}

  async ready(): Promise<void> {
    if (this.isCleanedUp) {
      throw new Error('Cannot call ready() on cleaned up LocalBattleSystem')
    }
    if (this.battleStarted) return
    this.battleStarted = true

    // Start the battle asynchronously
    this.battlePromise = this.battle.startBattle().catch(error => {
      console.error('Battle error:', error)
      throw error
    })
  }

  async getAvailableSelection(playerId: playerId) {
    if (this.isCleanedUp) {
      throw new Error('Cannot call getAvailableSelection() on cleaned up LocalBattleSystem')
    }
    return this.battle.getAvailableSelection(playerId)
  }

  async submitAction(selection: PlayerSelection) {
    if (this.isCleanedUp) {
      throw new Error('Cannot call submitAction() on cleaned up LocalBattleSystem')
    }
    this.battle.setSelection(selection)
  }

  async getState(playerId?: playerId, showHidden = false): Promise<BattleState> {
    if (this.isCleanedUp) {
      throw new Error('Cannot call getState() on cleaned up LocalBattleSystem')
    }
    return this.battle.getState(playerId, showHidden ?? true)
  }

  BattleEvent(callback: (message: BattleMessage) => void): () => void {
    if (this.isCleanedUp) {
      throw new Error('Cannot call BattleEvent() on cleaned up LocalBattleSystem')
    }
    this.battle.registerListener(callback)
    return () => {}
  }

  // 计时器相关方法实现
  async isTimerEnabled(): Promise<boolean> {
    if (this.isCleanedUp) {
      throw new Error('Cannot call isTimerEnabled() on cleaned up LocalBattleSystem')
    }
    return this.battle.isTimerEnabled()
  }

  async getPlayerTimerState(playerId: playerId): Promise<PlayerTimerState | null> {
    if (this.isCleanedUp) {
      throw new Error('Cannot call getPlayerTimerState() on cleaned up LocalBattleSystem')
    }
    return this.battle.getPlayerTimerState(playerId)
  }

  async getAllPlayerTimerStates(): Promise<PlayerTimerState[]> {
    if (this.isCleanedUp) {
      throw new Error('Cannot call getAllPlayerTimerStates() on cleaned up LocalBattleSystem')
    }
    return this.battle.getAllPlayerTimerStates()
  }

  async getTimerConfig(): Promise<TimerConfig> {
    if (this.isCleanedUp) {
      throw new Error('Cannot call getTimerConfig() on cleaned up LocalBattleSystem')
    }
    return this.battle.getTimerConfig()
  }

  async startAnimation(source: string, expectedDuration: number, ownerId: playerId): Promise<string> {
    if (this.isCleanedUp) {
      throw new Error('Cannot call startAnimation() on cleaned up LocalBattleSystem')
    }
    return this.battle.startAnimation(source, expectedDuration, ownerId)
  }

  async endAnimation(animationId: string, actualDuration?: number): Promise<void> {
    if (this.isCleanedUp) {
      throw new Error('Cannot call endAnimation() on cleaned up LocalBattleSystem')
    }
    this.battle.endAnimation(animationId, actualDuration)
  }

  // 计时器事件监听方法
  onTimerEvent<K extends keyof Events>(eventType: K, handler: (data: Events[K]) => void): () => void {
    if (this.isCleanedUp) {
      throw new Error('Cannot call onTimerEvent() on cleaned up LocalBattleSystem')
    }
    return this.battle.onTimerEvent(eventType, handler)
  }

  offTimerEvent<K extends keyof Events>(eventType: K, handler: (data: Events[K]) => void): void {
    if (this.isCleanedUp) {
      throw new Error('Cannot call offTimerEvent() on cleaned up LocalBattleSystem')
    }
    this.battle.offTimerEvent(eventType, handler)
  }

  // Get the battle promise for external handling if needed
  getBattlePromise(): Promise<void> | undefined {
    return this.battlePromise
  }

  /**
   * Clean up all resources and subscriptions associated with this battle system
   */
  async cleanup(): Promise<void> {
    if (this.isCleanedUp) {
      console.warn('LocalBattleSystem already cleaned up')
      return
    }

    this.isCleanedUp = true

    try {
      // Wait for battle to complete if it's still running
      if (this.battlePromise) {
        try {
          await this.battlePromise
        } catch (error) {
          // Battle may have failed, but we still need to clean up
          console.warn('Battle promise rejected during cleanup:', error)
        }
      }

      // Clean up the underlying battle instance
      await this.battle.cleanup()

      console.log(`LocalBattleSystem cleanup completed for battle ${this.battle.id}`)
    } catch (error) {
      console.error('Error during LocalBattleSystem cleanup:', error)
      throw error
    }
  }

  /**
   * Check if this battle system has been cleaned up
   */
  isDestroyed(): boolean {
    return this.isCleanedUp
  }
}
