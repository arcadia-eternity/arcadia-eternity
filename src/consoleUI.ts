import {
  Player,
  PlayerSelection,
  UseSkillSelection,
  SwitchPetSelection,
  BattleSystem,
  DoNothingSelection,
} from './battleSystem'
import readline from 'readline'
import { BattleUI } from './ui'

export class ConsoleUI extends BattleUI {
  protected battle: BattleSystem
  constructor(
    battle: BattleSystem,
    private playerA: Player,
    private playerB: Player,
  ) {
    super(battle)
    this.battle = battle
    battle.onMessage(this.handleMessage)
  }

  private handleMessage(message: string) {
    console.log(message)
  }

  // 修改操作提示逻辑
  private async getPlayerAction(player: Player): Promise<PlayerSelection> {
    // 强制换宠时限制只能选择换宠
    if (this.battle.pendingDefeatedPlayer === player) {
      return this.getForcedSwitchAction(player)
    }
    return this.getNormalAction(player)
  }

  private async getNormalAction(player: Player): Promise<PlayerSelection> {
    console.log(player.activePet.status)

    const actions = this.battle.getAvailableSelection(player)
    console.log('可用操作：')

    // 1. 显示可用技能
    const validSkills = actions.filter((a): a is UseSkillSelection => a.type === 'use-skill')
    validSkills.forEach((a, i) =>
      console.log(`${i + 1}. 使用技能: ${a.skill.name} (威力:${a.skill.power}, 消耗:${a.skill.rageCost})`),
    )

    // 2. 显示更换精灵选项
    const switchActions = actions.filter((a): a is SwitchPetSelection => a.type === 'switch-pet')
    switchActions.forEach((a, i) => console.log(`${validSkills.length + i + 1}. 更换精灵: ${a.pet.name}`))

    // 3. 显示什么都不做选项
    const doNothingIndex = actions.filter((a): a is DoNothingSelection => a.type === 'do-nothing')
    doNothingIndex.forEach(() => console.log(`${validSkills.length + switchActions.length + 1}. 什么都不做`))

    // 4. 获取玩家选择
    while (true) {
      const choice = parseInt(await this.question('选择操作编号: '))
      const action = this.getSelectionByChoice(player, choice, validSkills, switchActions)
      if (action) return action

      console.log('无效选择，请输入正确的操作编号！')
    }
  }

  private getSelectionByChoice(
    player: Player,
    choice: number,
    validSkills: UseSkillSelection[],
    switchActions: SwitchPetSelection[],
  ): PlayerSelection | null {
    // 选择技能
    if (choice >= 1 && choice <= validSkills.length) {
      return validSkills[choice - 1]
    }

    // 选择更换精灵
    if (choice > validSkills.length && choice <= validSkills.length + switchActions.length) {
      return switchActions[choice - validSkills.length - 1]
    }

    // 选择什么都不做
    if (choice === validSkills.length + switchActions.length + 1) {
      return { type: 'do-nothing', source: player }
    }

    // 无效选择
    return null
  }

  private question(prompt: string): Promise<string> {
    return new Promise(resolve => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })
      rl.question(prompt, answer => {
        rl.close()
        resolve(answer)
      })
    })
  }

  public async run(): Promise<void> {
    const battle = this.battle.startBattle()
    let generator = battle.next() // 初始化生成器

    while (!generator.done) {
      if (this.battle.pendingDefeatedPlayer) {
        const action = await this.getForcedSwitchAction(this.battle.pendingDefeatedPlayer)
        generator = battle.next(action)
        continue
      }

      // 处理击败方换宠
      if (this.battle.lastKiller && this.battle.allowKillerSwitch) {
        const action = await this.handleKillerSwitch(this.battle.lastKiller)
        generator = battle.next(action)
        continue
      }
      const currentPlayer = this.getCurrentActivePlayer()
      if (!currentPlayer) break

      // 获取玩家选择
      const selection = await this.getPlayerAction(currentPlayer)

      // 将选择发送给生成器
      generator = battle.next(selection)
    }
    const victor = generator.value as Player
    console.log(`胜利者是: ${victor.name}`)
  }

  private getCurrentActivePlayer(): Player | null {
    // 优先处理强制换宠
    if (this.battle.pendingDefeatedPlayer) {
      return this.battle.pendingDefeatedPlayer
    }

    // 正常回合按顺序处理
    if (!this.playerA.selection) return this.playerA
    if (!this.playerB.selection) return this.playerB
    return null
  }

  private async handleKillerSwitch(player: Player): Promise<PlayerSelection> {
    console.log(`\n==== ${player.name} 可以更换精灵 ====`)
    const actions = this.battle.getAvailableSwitch(player)

    // 显示可选操作
    console.log('1. 保持当前精灵')
    actions.forEach((a, i) => console.log(`${i + 2}. 更换为 ${a.pet.name}`))

    while (true) {
      const choice = parseInt(await this.question('请选择操作: '))
      if (choice === 1) {
        return { type: 'do-nothing', source: player }
      }
      if (choice >= 2 && choice <= actions.length + 1) {
        return actions[choice - 2]
      }
      console.log('无效的选择！')
    }
  }

  private async getForcedSwitchAction(player: Player): Promise<PlayerSelection> {
    const actions = this.battle.getAvailableSwitch(player) as SwitchPetSelection[]
    console.log('必须更换精灵！可用选项：')
    actions.forEach((a, i) => console.log(`${i + 1}. 更换为 ${a.pet.name}`))

    while (true) {
      const choice = parseInt(await this.question('请选择更换的精灵：'))
      if (choice >= 1 && choice <= actions.length) {
        return actions[choice - 1]
      }
      console.log('无效选择！')
    }
  }
}
