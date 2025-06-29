import type { IBattleSystemWithDev } from '@arcadia-eternity/interface'
import { Battle } from '@arcadia-eternity/battle'
import type {
  BattleMessage,
  BattleState,
  playerId,
  petId,
  PlayerSelection,
  PlayerTimerState,
  TimerConfig,
  Events,
} from '@arcadia-eternity/const'
import { BattleMessageType } from '@arcadia-eternity/const'

export class LocalBattleSystem implements IBattleSystemWithDev {
  private battleStarted: boolean = false
  private battlePromise?: Promise<void>
  private isCleanedUp: boolean = false

  constructor(private battle: Battle) {}

  async ready(): Promise<void> {
    if (this.isCleanedUp) {
      throw new Error('Cannot call ready() on cleaned up LocalBattleSystem')
    }
    if (this.battleStarted) {
      console.warn(`Battle ${this.battle.id} already started, ignoring duplicate ready() call`)
      return
    }
    this.battleStarted = true

    console.log(`Starting battle ${this.battle.id} via LocalBattleSystem.ready()`)

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

  // 开发者功能方法
  setDevPetHp(petId: string, hp: number): void {
    if (this.isCleanedUp) {
      throw new Error('Cannot call setDevPetHp() on cleaned up LocalBattleSystem')
    }

    // 找到对应的宠物并设置血量
    const players = [this.battle.playerA, this.battle.playerB]
    for (const player of players) {
      const pet = player.team.find(p => p.id === petId)
      if (pet) {
        const oldHp = pet.currentHp
        const newHp = Math.max(0, Math.min(hp, pet.stat.maxHp))

        // 使用attributeSystem设置血量
        pet.currentHp = newHp

        // 更新存活状态
        if (newHp === 0) {
          pet.isAlive = false
        } else {
          pet.isAlive = true
        }

        console.debug(`设置宠物 ${pet.name} 血量从 ${oldHp} 变为 ${newHp}`)

        // 发送消息通知前端更新
        this.battle.emitMessage(BattleMessageType.HpChange, {
          pet: petId as petId,
          before: oldHp,
          after: newHp,
          maxHp: pet.stat.maxHp,
          reason: 'heal', // 使用heal作为开发者调试的原因
        })
        break
      }
    }
  }

  setDevPlayerRage(playerId: string, rage: number): void {
    if (this.isCleanedUp) {
      throw new Error('Cannot call setDevPlayerRage() on cleaned up LocalBattleSystem')
    }

    const player = [this.battle.playerA, this.battle.playerB].find(p => p.id === playerId)
    if (player) {
      const oldRage = player.currentRage
      const newRage = Math.max(0, Math.min(rage, 150))

      // 使用attributeSystem设置怒气
      player.currentRage = newRage

      console.debug(`设置玩家 ${player.name} 怒气从 ${oldRage} 变为 ${newRage}`)

      // 发送消息通知前端更新
      this.battle.emitMessage(BattleMessageType.RageChange, {
        player: playerId as playerId,
        pet: player.activePet.id,
        before: oldRage,
        after: newRage,
        reason: 'effect', // 使用effect作为开发者调试的原因
      })
    }
  }

  forceAISelection(selection: PlayerSelection): void {
    if (this.isCleanedUp) {
      throw new Error('Cannot call forceAISelection() on cleaned up LocalBattleSystem')
    }

    // 强制AI做出指定选择
    this.battle.setSelection(selection)
    console.debug(`强制AI选择:`, selection)
  }

  getAvailableActionsForPlayer(playerId: string): PlayerSelection[] {
    if (this.isCleanedUp) {
      throw new Error('Cannot call getAvailableActionsForPlayer() on cleaned up LocalBattleSystem')
    }

    return this.battle.getAvailableSelection(playerId as playerId)
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
