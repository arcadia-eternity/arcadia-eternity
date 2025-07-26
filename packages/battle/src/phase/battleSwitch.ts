import { BattleMessageType, type SwitchPetSelection } from '@arcadia-eternity/const'
import { InteractivePhase } from './base'
import { Context } from '../context'
import { SwitchPetPhase } from './switch'
import type { Battle } from '../battle'

/**
 * BattleSwitchContext for battle-level switch phase
 */
export class BattleSwitchContext extends Context {
  readonly type = 'battle-switch'
  public readonly battle: Battle

  constructor(battle: Battle) {
    super(null)
    this.battle = battle
  }
}

/**
 * BattleSwitchPhase handles the switch phase of battle
 * This includes forced switches and faint switches
 */
export class BattleSwitchPhase extends InteractivePhase<BattleSwitchContext> {
  constructor(battle: Battle, id?: string) {
    super(battle, id)
  }

  protected createContext(): BattleSwitchContext {
    return new BattleSwitchContext(this.battle)
  }

  protected async executeOperation(): Promise<void> {
    // 持续处理更换，直到没有更多需要更换的精灵
    while (true) {
      // 收集需要强制更换的玩家
      this.battle.pendingForcedSwitches = [this.battle.playerA, this.battle.playerB].filter(
        player => !player.activePet.isAlive,
      )

      // 检查是否有击破奖励更换
      // 重要：如果双方都需要强制更换，则不应该有击破奖励更换
      if (this.battle.allowFaintSwitch && this.battle.lastKiller && this.battle.pendingForcedSwitches.length < 2) {
        this.battle.pendingFaintSwitch = this.battle.lastKiller
      } else {
        this.battle.pendingFaintSwitch = undefined
      }

      // 如果没有任何需要更换的情况，退出循环
      if (this.battle.pendingForcedSwitches.length === 0 && !this.battle.pendingFaintSwitch) {
        break
      }

      // 检查战斗是否结束
      if (this.battle.isBattleEnded()) {
        return
      }

      // 判断是否为初始更换阶段（需要同时执行）
      this.battle.isInitialSwitchPhase =
        this.battle.pendingForcedSwitches.length > 0 || this.battle.pendingFaintSwitch !== undefined

      // 处理初始更换阶段（强制更换和击破奖励更换同时进行）
      if (this.battle.isInitialSwitchPhase) {
        await this.handleInitialSwitchPhase()
      }

      // 重置状态，准备下一轮检查
      this.battle.isInitialSwitchPhase = false
      this.battle.pendingForcedSwitches = []
      this.battle.pendingFaintSwitch = undefined
      this.battle.lastKiller = undefined
    }
  }

  private async handleInitialSwitchPhase(): Promise<void> {
    // 收集所有需要更换的玩家
    const playersNeedingSwitch = [...this.battle.pendingForcedSwitches]
    if (this.battle.pendingFaintSwitch) {
      playersNeedingSwitch.push(this.battle.pendingFaintSwitch)
    }

    // 如果没有玩家需要更换，直接返回
    if (playersNeedingSwitch.length === 0) {
      return
    }

    // 发送更换请求消息
    if (this.battle.pendingForcedSwitches.length > 0) {
      this.battle.emitMessage(BattleMessageType.ForcedSwitch, {
        player: this.battle.pendingForcedSwitches.map(p => p.id),
      })
    }

    if (this.battle.pendingFaintSwitch) {
      this.battle.emitMessage(BattleMessageType.FaintSwitch, {
        player: this.battle.pendingFaintSwitch.id,
      })
    }

    // 等待所有玩家完成更换选择
    await this.battle.waitForSwitchSelections(playersNeedingSwitch)

    // 执行所有更换操作
    for (const player of playersNeedingSwitch) {
      if (player.selection?.type === 'surrender') {
        this.battle.handleSurrender(player.id)
        return
      } else if (player.selection?.type === 'switch-pet') {
        const selectionPet = this.battle.getPetByID((player.selection as SwitchPetSelection).pet)
        const switchPhase = new SwitchPetPhase(this.battle, player, selectionPet, this)
        this.battle.phaseManager.registerPhase(switchPhase)
        await this.battle.phaseManager.executePhase(switchPhase.id)
      }
      player.selection = null
      // 通知TimerManager选择状态已清理
      this.battle.timerManager.handlePlayerSelectionChange(player.id, false)
    }
  }
}
