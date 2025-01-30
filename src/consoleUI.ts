import { BattleUI, Player, PlayerAction } from './battleSystem'
import readline from 'readline'

export class ConsoleUI implements BattleUI {
  constructor(
    private playerA: Player,
    private playerB: Player,
  ) {}
  async getPlayersActions(
    player1: Player,
    player1Actions: PlayerAction[],
    player2: Player,
    player2Actions: PlayerAction[],
  ): Promise<[PlayerAction, PlayerAction]> {
    // 显示玩家1的选择界面
    console.log('=== 玩家1 的选择 ===')
    const player1Action = await this.getPlayerAction(player1, player1Actions)

    // 显示玩家2的选择界面
    console.log('\n=== 玩家2 的选择 ===')
    const player2Action = await this.getPlayerAction(player2, player2Actions)

    return [player1Action, player2Action]
  }

  async getPlayerAction(player: Player, actions: PlayerAction[]): Promise<PlayerAction> {
    console.log(player.activePet.status)
    console.log('可用操作：')

    // 1. 显示可用技能
    const validSkills = actions.filter((a): a is Extract<PlayerAction, { type: 'use-skill' }> => a.type === 'use-skill')
    validSkills.forEach((a, i) =>
      console.log(`${i + 1}. 使用技能: ${a.skill.name} (威力:${a.skill.power}, 消耗:${a.skill.rageCost})`),
    )

    // 2. 显示更换精灵选项
    const switchActions = actions.filter(
      (a): a is Extract<PlayerAction, { type: 'switch-pet' }> => a.type === 'switch-pet',
    )
    switchActions.forEach((a, i) => console.log(`${validSkills.length + i + 1}. 更换精灵: ${a.pet.name}`))

    // 3. 显示什么都不做选项
    const doNothingIndex = validSkills.length + switchActions.length + 1
    console.log(`${doNothingIndex}. 什么都不做`)

    // 4. 获取玩家选择
    while (true) {
      const choice = parseInt(await this.question('选择操作编号: '))
      const action = this.getActionByChoice(player, choice, validSkills, switchActions)
      if (action) return action

      console.log('无效选择，请输入正确的操作编号！')
    }
  }

  private getActionByChoice(
    player: Player,
    choice: number,
    validSkills: Extract<PlayerAction, { type: 'use-skill' }>[],
    switchActions: Extract<PlayerAction, { type: 'switch-pet' }>[],
  ): PlayerAction | null {
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
      return { source: player, type: 'do-nothing' }
    }

    // 无效选择
    return null
  }

  showMessage(msg: string): void {
    console.log(msg)
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
}
