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

  private async getPlayerAction(player: Player): Promise<PlayerSelection> {
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
    this.battle.startBattle()
    do {
      while (!this.battle.setSelection(this.playerA, await this.getPlayerAction(this.playerA))) {
        console.log('选择无效，请重新选择!')
      }
      while (!this.battle.setSelection(this.playerB, await this.getPlayerAction(this.playerB))) {
        console.log('选择无效，请重新选择!')
      }
    } while (!this.battle.performTurn())
  }
}
