import { Battle } from '@/core/battle'
import { Player } from '@core/player'
import { type PlayerSelection } from '@core/selection'
import readline from 'readline'
import { type BattleMessage, BattleMessageType } from '@core/message'
import { Pet } from '@core/pet'
import { ELEMENT_MAP } from '@core/element'
import { Mark } from '@core/mark'
import { Category, Skill } from '@core/skill'
import { UseSkillSelection, SwitchPetSelection, DoNothingSelection } from '@/core/selection'

export class ConsoleUI {
  protected battle: Battle
  private messages: BattleMessage[] = []
  private allPets: Pet[] // 新增：存储所有宠物的数组
  constructor(
    battle: Battle,
    private playerA: Player,
    private playerB: Player,
  ) {
    this.battle = battle
    battle.registerListener(this.handleMessage.bind(this)) //this的上下文应该为本身
    this.allPets = [...playerA.team, ...playerB.team]
  }

  private getPetStatus = (pet: Pet) => {
    const baseInfo = `${ELEMENT_MAP[pet.element].emoji}${pet.name}(${pet.species.name}) [Lv.${pet.level} HP:${pet.currentHp}/${pet.maxHp} Rage:${pet.owner?.currentRage}/100]`
    const markInfo = pet.marks.length > 0 ? ' 印记:' + pet.marks.map(mark => this.getMarkStatus(mark)).join(' ') : ''
    return baseInfo + markInfo
  }

  private getPetById(id: string): Pet {
    return this.battle.getPetByID(id)
  }

  private getSkillById(id: string): Skill {
    return this.battle.getSkillByID(id)
  }

  private getPetNameById(id: string): string {
    const pet = this.allPets.find(p => p.id === id)
    return pet ? pet.name : id
  }

  private getPlayerNameById(id: string): string {
    const name = [this.playerA, this.playerB].find(p => p.id === id)?.name
    return name ?? id
  }

  private getMarkStatus = (mark: Mark) =>
    `{<${mark.name}> ${mark.config.persistent ? '' : `[剩余${mark.duration}回合]`} ${mark.stack}层}`

  private handleMessage(message: BattleMessage) {
    this.messages.push(message)

    switch (message.type) {
      case BattleMessageType.BattleState:
        //TODO：全局状态展示
        break

      case BattleMessageType.BattleStart:
        console.log(`⚔️ 对战开始！`)
        console.log(`玩家A: ${this.getPetStatus(this.playerA.activePet)}`)
        console.log(`玩家B: ${this.getPetStatus(this.playerB.activePet)}`)
        break

      case BattleMessageType.RoundStart:
        console.log(`\n=== 第 ${message.data.round} 回合 ===`)
        break

      case BattleMessageType.RageChange: {
        const d = message.data
        const name = this.getPetNameById(d.pet)
        console.log(`⚡ ${name} 怒气 ${d.before} → ${d.after} (${this.getRageReason(d.reason)})`)
        break
      }

      case BattleMessageType.SkillUse: {
        const d = message.data
        const userName = this.getPetNameById(d.user)
        const targetName = this.getPetNameById(d.target)
        console.log(`🎯 ${userName} 使用 ${d.skill}（消耗${d.rageCost}怒气） → ${targetName}`)
        break
      }

      case BattleMessageType.SkillMiss: {
        const d = message.data
        const userName = this.getPetNameById(d.user)
        console.log(`❌ ${userName} 的 ${d.skill} 未命中！ (${this.translateMissReason(d.reason)})`)
        break
      }

      case BattleMessageType.Damage: {
        const d = message.data
        const targetName = this.getPetNameById(d.target)
        const sourceName = this.getPetNameById(d.source)
        let log = `💥 ${targetName} 受到 ${d.damage}点 来自<${sourceName}>的${this.getDamageType(d.damageType)}伤害`
        if (d.isCrit) log += ' (暴击)'
        if (d.effectiveness > 1) log += ' 效果拔群！'
        if (d.effectiveness < 1) log += ' 效果不佳...'
        log += ` (剩余HP: ${d.currentHp}/${d.maxHp})`
        console.log(log)
        break
      }

      case BattleMessageType.Heal: {
        const d = message.data
        const targetName = this.getPetNameById(d.target)
        console.log(`💚 ${targetName} 恢复 ${message.data.amount}点HP`)
        break
      }

      case BattleMessageType.PetSwitch: {
        const d = message.data
        const fromPetName = this.getPetNameById(d.fromPet)
        const toPetName = this.getPetNameById(d.toPet)
        const playerName = this.getPlayerNameById(d.player)
        console.log(`🔄 ${playerName} 更换精灵：${fromPetName} → ${toPetName}`)
        console.log(`   ${toPetName} 剩余HP: ${d.currentHp}`)
        break
      }

      case BattleMessageType.PetDefeated: {
        const d = message.data
        const killerName = this.getPetNameById(d.pet)
        const petName = d.killer ? this.getPlayerNameById(d.killer) : ''
        console.log(`☠️ ${petName} 倒下！${message.data.killer ? `(击败者: ${killerName})` : ''}`)
        break
      }

      case BattleMessageType.StatChange: {
        const d = message.data
        const petName = this.getPetNameById(d.pet)
        const arrow = d.stage > 0 ? '↑' : '↓'
        console.log(`📈 ${petName} ${this.translateStat(d.stat)} ${arrow.repeat(Math.abs(d.stage))} (${d.reason})`)
        break
      }

      case BattleMessageType.MarkApply: {
        const d = message.data
        const targetName = this.getPetNameById(d.target)
        console.log(`🔖 ${targetName} 被施加【${message.data.markType}】印记`)
        break
      }

      case BattleMessageType.MarkTrigger:
        console.log(`✨ ${message.data.markType} 印记触发：${message.data.effect}`)
        break

      case BattleMessageType.BattleEnd:
        console.log(`\n🎉 对战结束！胜利者：${message.data.winner}`)
        console.log(`➤ 结束原因：${this.translateEndReason(message.data.reason)}`)
        break

      case BattleMessageType.ForcedSwitch:
        console.log(`${message.data.player.join(',')} 必须更换倒下的精灵！`)
        break

      case BattleMessageType.Crit: {
        const d = message.data
        const targetName = this.getPetNameById(d.target)
        const attackerName = this.getPetNameById(d.attacker)
        console.log(`🔥 ${attackerName} 对 ${targetName} 造成了暴击伤害！`)
        break
      }
      case BattleMessageType.FaintSwitch: {
        console.log(`🎁 ${message.data.player} 击倒对手，获得换宠机会！`)
        break
      }

      case BattleMessageType.Info: {
        console.log(`INFO: ${message.data.message}`)
        break
      }

      case BattleMessageType.TurnAction: {
        console.log(`===========选择============`)
        break
      }

      default:
        console.warn('未知消息类型:', JSON.stringify(message))
    }
  }

  private getRageReason(reason: string): string {
    const reasons: Record<string, string> = {
      turn: '回合增长',
      damage: '受伤获得',
      skill: '技能消耗',
      switch: '切换精灵',
    }
    return reasons[reason] || reason
  }

  private translateMissReason(reason: string): string {
    return (
      {
        accuracy: '命中未达标',
        dodge: '被对方闪避',
        immune: '属性免疫',
      }[reason] || reason
    )
  }

  private getDamageType(type: string): string {
    return (
      {
        physical: '物理',
        special: '特殊',
        effect: '效果',
      }[type] || type
    )
  }

  private translateStat(stat: string): string {
    const stats: Record<string, string> = {
      atk: '攻击',
      def: '防御',
      spd: '速度',
      critRate: '暴击率',
    }
    return stats[stat] || stat
  }

  private translateEndReason(reason: string): string {
    return reason === 'all_pet_fainted' ? '全部精灵失去战斗能力' : '玩家投降'
  }

  // 修改操作提示逻辑
  private async getPlayerAction(player: Player): Promise<PlayerSelection> {
    // 强制换宠时限制只能选择换宠
    if (this.battle.pendingDefeatedPlayers.includes(player)) {
      return this.getForcedSwitchAction(player)
    }
    return this.getNormalAction(player)
  }

  private async getNormalAction(player: Player): Promise<PlayerSelection> {
    console.log(this.getPetStatus(player.activePet))

    const actions = player.getAvailableSelection()
    console.log('可用操作：')

    // 1. 显示可用技能
    const validSkills = actions.filter((a): a is UseSkillSelection => a.type === 'use-skill')
    validSkills.forEach((a, i) => {
      const skill = this.getSkillById(a.skill)
      const skillTypeIcon = {
        [Category.Physical]: '⚔️',
        [Category.Special]: '🔮',
        [Category.Status]: '⭐',
        [Category.Climax]: '⚡',
      }[skill.category]

      const powerText = skill.category === Category.Status ? '' : `, 威力:${skill.power}`
      console.log(
        `${i + 1}. 使用技能: ${ELEMENT_MAP[skill.element].emoji}${skill.name} (${skillTypeIcon}${powerText}, 消耗:${skill.rage})`,
      )
    })

    // 2. 显示更换精灵选项
    const switchActions = actions.filter((a): a is SwitchPetSelection => a.type === 'switch-pet')
    switchActions.forEach((a, i) => {
      const pet = this.getPetById(a.pet)
      console.log(`${validSkills.length + i + 1}. 更换精灵: ${this.getPetStatus(pet)}`)
    })

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
      return { type: 'do-nothing', player: player.id }
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
      const lastMessage = this.messages.findLast(() => true)

      // 处理强制换宠阶段
      if (lastMessage?.type == BattleMessageType.ForcedSwitch) {
        const player = this.battle.getPendingSwitchPlayer()
        if (player && !player.selection) {
          console.log(`\n==== ${player.name} 必须更换倒下的精灵 ====`)
          let action: PlayerSelection
          do {
            action = await this.getForcedSwitchAction(player)
          } while (!player.setSelection(action))
          generator = battle.next()
          continue
        }
      }

      // 处理击破奖励换宠
      if (lastMessage?.type == BattleMessageType.FaintSwitch) {
        console.log(`\n==== ${lastMessage.data.player} 获得击破奖励换宠机会 ====`)
        const player = [this.playerA, this.playerB].find(player => player.id === lastMessage.data.player)
        if (!player) continue
        let action: PlayerSelection
        do {
          action = await this.handleFaintSwitch(player)
        } while (!player.setSelection(action))
        generator = battle.next()
        continue
      }

      if (lastMessage?.type == BattleMessageType.TurnAction) {
        // 获取当前需要操作的玩家
        const currentPlayer = this.getCurrentActivePlayer()
        if (!currentPlayer) {
          generator = battle.next()
          continue
        }
        let selection: PlayerSelection
        do {
          selection = await this.getPlayerAction(currentPlayer)
        } while (!currentPlayer.setSelection(selection))
        battle.next()
      }
    }
    const victor = this.battle.getVictor()
    console.log(`\n🏆 胜利者是: ${victor?.name || '平局'}！`)
  }

  private getCurrentActivePlayer(): Player | null {
    // 优先处理强制换宠
    if (this.battle.pendingDefeatedPlayers.length > 0) {
      return null
    }

    // 正常回合按顺序处理
    if (!this.playerA.selection) return this.playerA
    if (!this.playerB.selection) return this.playerB
    return null
  }

  private async handleFaintSwitch(player: Player): Promise<PlayerSelection> {
    console.log(`\n==== ${player.name} 可以更换精灵(击破奖励) ====`)
    const actions = player.getAvailableSwitch()

    // 显示可选操作
    console.log('1. 保持当前精灵')

    actions.forEach((a, i) => {
      const pet = this.getPetById(a.pet)
      console.log(`${i + 2}. 更换精灵: ${this.getPetStatus(pet)}`)
    })

    while (true) {
      const choice = parseInt(await this.question('请选择操作: '))
      if (choice === 1) {
        return { type: 'do-nothing', player: player.id }
      }
      if (choice >= 2 && choice <= actions.length + 1) {
        return actions[choice - 2]
      }
      console.log('无效的选择！')
    }
  }

  private async getForcedSwitchAction(player: Player): Promise<PlayerSelection> {
    const actions = player.getAvailableSelection() as SwitchPetSelection[]
    console.log('必须更换精灵！可用选项：')
    actions.forEach((a, i) => {
      const pet = this.getPetById(a.pet)
      console.log(`${i + 1}. 更换精灵: ${this.getPetStatus(pet)}`)
    })

    while (true) {
      const choice = parseInt(await this.question('请选择更换的精灵：'))
      if (choice >= 1 && choice <= actions.length) {
        return actions[choice - 1]
      }
      console.log('无效选择！')
    }
  }
}
