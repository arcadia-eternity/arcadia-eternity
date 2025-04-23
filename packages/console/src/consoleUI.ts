import {
  BattleMessageType,
  BattlePhase,
  BattleStatus,
  Category,
  ELEMENT_MAP,
  type BattleMessage,
  type BattleState,
  type MarkMessage,
  type PetMessage,
  type playerId,
  type PlayerSelection,
  type SkillMessage,
} from '@arcadia-eternity/const'
import type { PlayerSelectionSchemaType } from '@arcadia-eternity/schema'
import { exit } from 'process'
import readline from 'readline'
import type { IBattleSystem } from '@arcadia-eternity/interface'
import i18next from 'i18next'
import { marked } from 'marked'
import TerminalRenderer from 'marked-terminal'
import * as jsondiffpatch from 'jsondiffpatch'
export class ConsoleUIV2 {
  private messages: BattleMessage[] = []
  public battleState: BattleState = {} as BattleState
  public currentPlayer: playerId[]

  constructor(
    private readonly battleInterface: IBattleSystem,
    ...currentPlayer: playerId[]
  ) {
    this.setupEventHandlers()

    const renderer = new TerminalRenderer({
      reflowText: false,
    })

    // 配置 marked
    // @ts-ignore
    marked.setOptions({ renderer })
    this.currentPlayer = currentPlayer
  }

  private setupEventHandlers() {
    this.battleInterface.BattleEvent(m => this.handleBattleMessage.call(this, m))
  }

  private async handleBattleMessage(message: BattleMessage) {
    this.messages.push(message)
    jsondiffpatch.patch(this.battleState, message.stateDelta)
    this.renderMessage(message)

    // 只在需要当前玩家操作时触发输入
    if (message.type === BattleMessageType.TurnAction) {
      const targetPlayers = message.data.player
      for (const p of this.currentPlayer) {
        if (targetPlayers.includes(p)) {
          await this.handlePlayerInput(p)
        }
      }
    }

    // 处理强制换宠逻辑
    if (message.type === BattleMessageType.ForcedSwitch) {
      const targetPlayers = message.data.player
      for (const p of this.currentPlayer) {
        if (targetPlayers.includes(p)) {
          console.log(`\n⚠️ ${this.getPlayerNameById(p)}必须更换倒下的精灵！`)
          await this.handlePlayerInput(p)
        }
      }
    }

    // 处理击破奖励换宠逻辑
    if (message.type === BattleMessageType.FaintSwitch) {
      for (const p of this.currentPlayer) {
        if (message.data.player === p) {
          console.log(`\n🎁 ${this.getPlayerNameById(p)}获得了击破奖励换宠机会！`)
          await this.handlePlayerInput(p)
        }
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
      this.renderActivePet(this.getPetById(player.activePet)!)
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
  ${elementEmoji} ${pet.name} [Lv.${pet.level}]
  HP: ${hpBar} ${pet.currentHp}/${pet.maxHp}
  属性：${this.getElementName(pet.element)}
  状态：${pet.marks.map(m => `\n    ${this.getMarkNameById(m.id)}×${m.stack} ${this.getMarkDescriptionById(m.id)} `).join(' ') || '无'}
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
      console.log(`◈ ${this.getMarkNameById(mark.id)} ×${mark.stack} (${durationInfo})`)
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
      case BattleMessageType.BattleStart:
        console.log(`⚔️ 对战开始！`)
        break

      case BattleMessageType.TurnStart:
        console.log(`\n=== 第 ${message.data.turn} 回合 ===`)
        break

      case BattleMessageType.TurnEnd:
        console.log(`=== 第 ${message.data.turn} 回合结束 ===`)
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
        console.log(`🎯 ${userName} 使用 ${this.getSkillNameById(d.skill)}（消耗${d.rage}怒气） → ${targetName}`)
        break
      }

      case BattleMessageType.SkillMiss: {
        const d = message.data
        const userName = this.getPetNameById(d.user)
        console.log(
          `❌ ${userName} 的 ${this.getSkillNameById(d.skill)} 未命中！ (${this.translateMissReason(d.reason)})`,
        )
        break
      }

      case BattleMessageType.SkillUseEnd: {
        const d = message.data
        const userName = this.getPetNameById(d.user)
        console.log(`✅ ${userName} 使用技能结束`)
        break
      }

      case BattleMessageType.Damage: {
        const d = message.data
        const targetName = this.getPetNameById(d.target)
        const sourceName = this.getNameById(d.source)
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
        const petId = this.getPetNameById(d.pet)
        const killerId = d.killer ? this.getPlayerNameById(d.killer) : ''
        console.log(`☠️ ${this.getPetNameById(petId)} 倒下！${message.data.killer ? `(击败者: ${killerId})` : ''}`)
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
        console.log(`🔖 ${targetName} 被施加【${message.data.baseMarkId}】印记`)
        break
      }

      case BattleMessageType.MarkDestory: {
        const d = message.data
        const targetName = this.getPetNameById(d.target)
        console.log(`🔖 ${targetName} 的【${message.data.mark}】印记消失`)
        break
      }

      case BattleMessageType.EffectApply:
        console.log(`✨ ${this.getNameById(message.data.source)} 效果触发：${message.data.effect}`)
        break

      case BattleMessageType.BattleEnd:
        console.log(
          `\n🎉 对战结束！胜利者：${message.data.winner ? this.getPlayerNameById(message.data.winner) : '无'}`,
        )
        console.log(`➤ 结束原因：${this.translateEndReason(message.data.reason)}`)
        exit(0)

      case BattleMessageType.ForcedSwitch:
        console.log(
          `${message.data.player.map(p => this.getPlayerNameById.call(this, p)).join(',')} 必须更换倒下的精灵！`,
        )
        break

      case BattleMessageType.FaintSwitch: {
        console.log(`🎁 ${this.getPlayerNameById(message.data.player)} 击倒对手，获得换宠机会！`)
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

      case BattleMessageType.InvalidAction: {
        console.log(
          `⚠️ ${this.getPlayerNameById(message.data.player)} 操作无效：${message.data.action} (${message.data.reason})`,
        )
        break
      }

      case BattleMessageType.PetRevive: {
        const d = message.data
        const petName = this.getPetById(d.pet)?.name || d.pet
        console.log(`💖 ${petName} 复活！`)
        break
      }

      case BattleMessageType.HpChange: {
        // const d = message.data
        // const petName = this.getPetById(d.pet)
        // const arrow = d.change > 0 ? '↑' : '↓'
        // console.log(`🩸 ${petName} HP ${arrow} ${Math.abs(d.change)} (${d.reason})`)
        break
      }

      case BattleMessageType.SkillUseFail: {
        const d = message.data
        const userName = this.getPetNameById(d.user)
        console.log(`❌ ${userName} 的 ${d.skill} 使用失败！原因：${this.translateFailReason(d.reason)}`)
        break
      }

      case BattleMessageType.DamageFail: {
        const d = message.data
        const targetName = this.getPetNameById(d.target)
        console.log(`🛡 ${targetName} 免疫了 ${d.source} 的伤害`)
        break
      }

      case BattleMessageType.HealFail: {
        const d = message.data
        const targetName = this.getPetNameById(d.target)
        console.log(`🚫 ${targetName} 治疗失败：${this.translateHealFailReason(d.reason)}`)
        break
      }

      case BattleMessageType.MarkExpire: {
        const d = message.data
        const targetName = this.getPetNameById(d.target)
        console.log(`⌛ ${targetName} 的【${d.mark}】印记已过期`)
        break
      }

      case BattleMessageType.MarkUpdate: {
        const d = message.data
        const targetName = this.getPetNameById(d.target)
        console.log(`🔄 ${targetName} 的【${d.mark.id}】印记更新：层数 ${d.mark.stack}，剩余 ${d.mark.duration} 回合`)
        break
      }

      case BattleMessageType.Error: {
        console.log(`❗️ 错误：${message.data.message}`)
        break
      }

      default:
        // @ts-expect-error
        console.log(`未知消息类型: ${message.type}`)
        // @ts-expect-error
        console.log(message.data)
    }
  }

  private getPlayerNameById(playerId: string): string {
    if (!this.battleState) return playerId
    const player = this.battleState.players.find(p => p.id === playerId)
    return player?.name || playerId
  }

  private getPetById(petId: string): PetMessage | undefined {
    if (!this.battleState) return undefined
    return this.battleState.players
      .map(p => p.team)
      .flat()
      .filter(p => p != undefined)
      .find(p => p.id === petId)
  }

  private getPetNameById(petId: string): string {
    if (!this.battleState) return petId
    const pet = this.getPetById(petId)
    return pet ? `${ELEMENT_MAP[pet.element].emoji}${pet.name}` : petId
  }

  private getSkillById(skillId: string): SkillMessage | undefined {
    if (!this.battleState) return undefined
    return this.battleState.players
      .map(p => p.team)
      .flat()
      .filter(p => p != undefined)
      .map(p => p.skills)
      .flat()
      .find(v => v && v.id && v.id == skillId)
  }

  private getSkillNameByBaseId(baseSkillId: string): string {
    try {
      return i18next.t(`${baseSkillId}.name`, {
        ns: 'skill',
      })
    } catch {
      return baseSkillId
    }
  }

  private getSkillNameById(skillId: string): string {
    const skill = this.getSkillById(skillId)
    return skill ? this.getSkillNameByBaseId(skill.baseId) : skillId
  }

  private getSkillDescriptionByBaseId(baseSkillId: string, skillMessage?: SkillMessage): string {
    try {
      return marked(
        i18next.t(`${baseSkillId}.description`, {
          ns: 'skill',
          skill: skillMessage,
        }),
        {
          async: false,
        },
      ).replace(/\n{2,}/g, '')
    } catch {
      return baseSkillId
    }
  }

  private getSkillDescriptionById(skillId: string): string {
    const skill = this.getSkillById(skillId)
    return skill ? this.getSkillDescriptionByBaseId(skill.baseId, skill) : skillId
  }

  private getMarkNameByBaseId(baseMarkId: string): string {
    try {
      return i18next.t(`${baseMarkId}.name`, {
        ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
      })
    } catch {
      return baseMarkId
    }
  }

  private getMarkDescriptionByBaseId(baseMarkId: string, markMessage?: MarkMessage): string {
    try {
      return i18next
        .t(`${baseMarkId}.description`, {
          ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
          mark: markMessage,
        })
        .replace(/\n{2,}/g, '')
    } catch {
      return baseMarkId
    }
  }

  private getMarkById(markId: string): MarkMessage | undefined {
    if (!this.battleState) return undefined
    return [
      ...this.battleState.marks,
      ...this.battleState.players
        .map(p => p.team)
        .flat()
        .filter(p => p != undefined)
        .map(p => p.marks)
        .flat(),
    ].find(m => m.id === markId)
  }

  private getMarkNameById(markId: string): string {
    if (!this.battleState) return markId
    const mark = this.getMarkById(markId)
    return mark ? this.getMarkNameByBaseId(mark.baseId) : markId
  }

  private getMarkDescriptionById(markId: string): string {
    if (!this.battleState) return markId
    const mark = this.getMarkById(markId)
    return mark ? this.getMarkDescriptionByBaseId(mark.baseId, mark) : markId
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

  private translateFailReason(reason: string): string {
    return (
      {
        'pet-fainted': '精灵已倒下',
        'invalid-target': '无效目标',
        'rage-not-enough': '怒气不足',
      }[reason] || reason
    )
  }

  private translateHealFailReason(reason: string): string {
    return (
      {
        'full-hp': 'HP已满',
        'heal-block': '治疗被封锁',
        'invalid-target': '无效目标',
      }[reason] || reason
    )
  }

  private getSpeciesNameById(speciesId: string): string {
    try {
      return i18next.t(`${speciesId}.name`, {
        ns: 'species',
      })
    } catch {
      return speciesId
    }
  }

  private getPetStatus = (pet: PetMessage) => {
    const baseInfo = `${ELEMENT_MAP[pet.element].emoji}${pet.name}(${this.getSpeciesNameById(pet.speciesID)})[Lv.${pet.level} HP:${pet.currentHp}/${pet.maxHp}]`
    const markInfo = pet.marks.length > 0 ? ' 印记:' + pet.marks.map(mark => this.getMarkStatus(mark)).join(' ') : ''
    return baseInfo + markInfo
  }

  private getMarkStatus = (mark: MarkMessage) =>
    `{<${this.getMarkNameById(mark.id)}> ${mark.duration < 0 ? '' : `[剩余${mark.duration}回合]`} ${mark.stack}层}`

  private getNameById(anyId: string) {
    if (anyId.length === 0) return ''
    const playerName = this.getPlayerNameById(anyId)
    if (playerName !== anyId) return playerName
    const petName = this.getPetNameById(anyId)
    if (petName !== anyId) return petName
    const markName = this.getMarkNameById(anyId)
    if (markName !== anyId) return markName
    const skillName = this.getSkillNameById(anyId)
    if (skillName !== anyId) return skillName
    return anyId
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
        Physical: '物理',
        Special: '特殊',
        Effect: '效果',
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

  private async handlePlayerInput(playerId: playerId) {
    this.renderBattleState()
    const selections = await this.battleInterface.getAvailableSelection(playerId)
    this.showSelectionMenu(selections)

    const choice = await this.prompt('请选择操作: ')
    const selection = this.parseSelection(selections, parseInt(choice))

    if (selection) {
      await this.battleInterface.submitAction(selection)
    } else {
      console.log('无效选择！')
      await this.handlePlayerInput(playerId)
    }
  }

  private showSelectionMenu(selections: PlayerSelectionSchemaType[]) {
    console.log('\n=== 可用操作 ===')
    selections.forEach((s, i) => {
      const index = i + 1
      switch (s.type) {
        case 'use-skill': {
          const skill = this.getSkillById(s.skill)
          const description = this.getSkillDescriptionByBaseId(skill!.baseId, skill)
          const skillTypeIcon = {
            [Category.Physical]: '⚔️',
            [Category.Special]: '🔮',
            [Category.Status]: '⭐',
            [Category.Climax]: '⚡',
          }[skill!.category]

          const powerText = skill!.category === Category.Status ? '' : `, 威力:${skill!.power}`
          console.log(
            `${index}. [技能] ${ELEMENT_MAP[skill!.element].emoji}${this.getSkillNameById(skill!.id)} (${skillTypeIcon}${powerText}, 消耗:${skill!.rage},${description})`,
          )
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
      const teamPet = this.battleState.players.flatMap(p => p.team || []).find(p => p.id === petId)
      if (teamPet) return teamPet
    }
    return undefined
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
}
