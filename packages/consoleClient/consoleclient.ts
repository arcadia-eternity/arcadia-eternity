import { BattleClient } from '@test-battle/client'
import {
  BattleMessageType,
  BattlePhase,
  BattleStatus,
  ELEMENT_MAP,
  type baseSkillId,
  type BattleMessage,
  type BattleState,
  type PetMessage,
  type playerId,
  type skillId,
  type SkillMessage,
} from '@test-battle/const'
import { DataRepository } from '@test-battle/data-repository'
import type { Player, PlayerSelection } from '@test-battle/schema'
import readline from 'readline'

export class ConsoleClient {
  private client: BattleClient
  private messages: BattleMessage[] = []
  public battleState?: BattleState
  public foe?: Player

  constructor(
    serverUrl: string,
    private playerData: Player,
  ) {
    this.client = new BattleClient({ serverUrl })
    this.setupEventHandlers()
  }

  private setupEventHandlers() {
    this.client.on('battleEvent', message => this.handleBattleMessage(message))
    this.client.on('matchSuccess', () => this.handleMatchSuccess())
  }

  public async connect() {
    await this.client.connect()
    await this.client.joinMatchmaking(this.playerData)
    console.log('等待匹配对手...')
  }

  private async handleBattleMessage(message: BattleMessage) {
    this.messages.push(message)
    this.renderMessage(message)

    // 只在需要当前玩家操作时触发输入
    if (message.type === BattleMessageType.TurnAction) {
      await this.handlePlayerInput()
    }

    // 处理强制换宠逻辑
    if (message.type === BattleMessageType.ForcedSwitch) {
      const targetPlayers = message.data.player
      if (targetPlayers.includes(this.playerData.id as playerId)) {
        console.log('\n⚠️ 你必须更换倒下的精灵！')
        await this.handlePlayerInput()
      }
    }

    // 处理击破奖励换宠逻辑
    if (message.type === BattleMessageType.FaintSwitch) {
      if (message.data.player === this.playerData.id) {
        console.log('\n🎁 你获得了击破奖励换宠机会！')
        await this.handlePlayerInput()
      }
    }
  }

  private renderBattleState() {
    if (!this.battleState) {
      console.log('战斗状态尚未初始化')
      return
    }

    // 基础信息
    console.log(`\n======== 战斗状态 [第 ${this.battleState.currentTurn} 回合] ========`)
    console.log(`阶段：${this.translatePhase(this.battleState.currentPhase)}`)
    console.log(`状态：${this.translateStatus(this.battleState.status)}`)

    // 玩家信息
    this.battleState.players.forEach(player => {
      console.log(`\n=== ${player.name} ===`)
      console.log(`怒气值：${player.rage}/100`)
      this.renderActivePet(player.activePet)
      console.log(`剩余可战斗精灵：${player.teamAlives}`)
    })

    // 战场效果
    this.renderBattleMarks()
  }

  /**
   * 渲染出战精灵详细信息
   */
  private renderActivePet(pet: PetMessage) {
    const hpBar = this.generateHpBar(pet.currentHp, pet.maxHp)
    const elementEmoji = ELEMENT_MAP[pet.element]?.emoji || '❓'

    console.log(
      `
  ${elementEmoji} ${pet.name} [Lv.??]
  HP: ${hpBar} ${pet.currentHp}/${pet.maxHp}
  属性：${this.getElementName(pet.element)}
  状态：${pet.marks.map(m => `${m.name}×${m.stack}`).join(' ') || '无'}
    `.trim(),
    )
  }

  /**
   * 渲染战场标记效果
   */
  private renderBattleMarks() {
    if (this.battleState!.marks.length === 0) return

    console.log('\n=== 印记效果 ===')
    this.battleState!.marks.forEach(mark => {
      const durationInfo = mark.duration > 0 ? `剩余 ${mark.duration} 回合` : '持续生效'
      console.log(`◈ ${mark.name} ×${mark.stack} (${durationInfo})`)
    })
  }

  // 辅助方法
  private translatePhase(phase: string): string {
    const phases: Record<string, string> = {
      [BattlePhase.SwitchPhase]: '换宠阶段',
      [BattlePhase.SelectionPhase]: '指令选择',
      [BattlePhase.ExecutionPhase]: '回合执行',
      [BattlePhase.Ended]: '已结束',
    }
    return phases[phase] || phase
  }

  private translateStatus(status: string): string {
    const statusMap: Record<string, string> = {
      [BattleStatus.Unstarted]: '未开始',
      [BattleStatus.OnBattle]: '进行中',
      [BattleStatus.Ended]: '已结束',
    }
    return statusMap[status] || status
  }

  private generateHpBar(current: number, max: number): string {
    const ratio = current / max
    const bars = 20
    const filled = Math.round(bars * ratio)
    return '█'.repeat(filled) + '░'.repeat(bars - filled)
  }

  private getElementName(element: string): string {
    return ELEMENT_MAP[element]?.name || element
  }

  private renderMessage(message: BattleMessage) {
    switch (message.type) {
      case BattleMessageType.BattleState:
        this.battleState = message.data
        this.renderBattleState()
        break

      case BattleMessageType.BattleStart:
        console.log(`⚔️ 对战开始！`)
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
    }
  }

  private getPlayerNameById(playerId: string): string {
    if (!this.battleState) return playerId
    const player = this.battleState.players.find(p => p.id === playerId)
    return player?.name || playerId
  }

  private getPetNameById(petId: string): string {
    if (!this.battleState) return petId
    for (const player of this.battleState.players) {
      // 检查当前出战精灵
      if (player.activePet.id === petId) return player.activePet.name
      // 检查队伍中的精灵
      const teamPet = player.team?.find(p => p.id === petId)
      if (teamPet) return teamPet.name
    }
    return petId
  }

  private getSkillNameById(skillId: string): string {
    try {
      return DataRepository.getInstance().getSkill(skillId as baseSkillId)?.name || skillId
    } catch {
      return skillId
    }
  }

  private getMarkNameById(markId: string): string {
    if (!this.battleState) return markId
    const mark = this.battleState.marks.find(m => m.id === markId)
    return mark?.name || markId
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

  private async handlePlayerInput() {
    const selections = await this.client.getAvailableSelection()
    this.showSelectionMenu(selections)

    const choice = await this.prompt('请选择操作: ')
    const selection = this.parseSelection(selections, parseInt(choice))

    if (selection) {
      await this.client.sendPlayerAction(selection)
    } else {
      console.log('无效选择！')
      await this.handlePlayerInput()
    }
  }

  private showSelectionMenu(selections: PlayerSelection[]) {
    console.log('\n=== 可用操作 ===')
    selections.forEach((s, i) => {
      const index = i + 1
      switch (s.type) {
        case 'use-skill': {
          const skill = this.findSkill(s.skill)
          console.log(`${index}. [技能] ${skill?.name}`)
          break
        }

        case 'switch-pet': {
          const pet = this.findPet(s.pet)
          console.log(`${index}. [换宠] 更换为 ${pet?.name}`)
          break
        }

        case 'do-nothing':
          console.log(`${index}. [待机] 本回合不行动`)
          break

        case 'surrender':
          console.log(`${index}. [投降] 结束对战`)
          break

        default:
          console.log(`${index}. 未知操作类型`)
      }
    })
  }

  private parseSelection(selections: PlayerSelection[], choice: number): PlayerSelection | null {
    return choice >= 1 && choice <= selections.length ? selections[choice - 1] : null
  }

  private findPet(petId: string): PetMessage | undefined {
    if (this.battleState) {
      // 检查所有玩家的当前出战精灵
      const activePet = this.battleState.players.map(p => p.activePet).find(p => p.id === petId)
      if (activePet) return activePet
      const teamPet = this.battleState.players.flatMap(p => p.team || []).find(p => p.id === petId)
      if (teamPet) return teamPet
    }
    return undefined
  }

  private findSkill(skillId: string): SkillMessage | undefined {
    try {
      return this.battleState?.players
        .map(p => p.activePet)
        .map(p => p.skills)
        .flat()
        .find(v => v && v.id && v.id == skillId)
    } catch (error) {
      console.log(error)
      return undefined
    }
  }

  private prompt(question: string): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    return new Promise(resolve =>
      rl.question(question, answer => {
        rl.close()
        resolve(answer)
      }),
    )
  }

  private handleMatchSuccess() {
    console.log('匹配成功！对战即将开始...')
  }
}
