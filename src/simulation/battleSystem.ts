import { TYPE_CHART } from './type'
import { SkillType, EffectTriggerPhase, Skill } from './skill'
import { Pet } from './pet'
import { MAX_RAGE, RAGE_PER_TURN, RAGE_PER_DAMAGE, AttackTargetOpinion } from './const'
import { Mark } from './mark'
import { BattleMessage, BattleMessageType, BattleMessageData } from './message'

export enum BattlePhase {
  SwitchPhase = 'SWITCH_PHASE',
  SelectionPhase = 'SELECTION_PHASE',
  ExecutionPhase = 'EXECUTION_PHASE',
  Ended = 'ENDED',
}

export class Player {
  public currentRage: number = 20
  constructor(
    public readonly name: string,
    public activePet: Pet,
    public readonly team: Pet[],
    public selection: PlayerSelection | null = null,
  ) {
    team.forEach(pet => pet.setOwner(this))
  }
}

// 对战系统
export class BattleSystem {
  public status: BattleStatus = BattleStatus.Unstarted
  public currentPhase: BattlePhase = BattlePhase.SelectionPhase
  private currentRound = 1
  private messageCallbacks: Array<(message: BattleMessage) => void> = []
  public pendingDefeatedPlayer?: Player // 新增：需要在下回合换宠的玩家
  public allowKillerSwitch: boolean
  public lastKiller?: Player

  constructor(
    public readonly playerA: Player,
    public readonly playerB: Player,
    options?: { allowKillerSwitch?: boolean },
  ) {
    this.allowKillerSwitch = options?.allowKillerSwitch ?? true
  }

  // 注册消息回调
  public onMessage(callback: (message: BattleMessage) => void) {
    this.messageCallbacks.push(callback)
  }

  // 发送消息给所有回调
  private emitMessage<T extends BattleMessageType>(type: T, data: BattleMessageData[T]) {
    const message: BattleMessage = {
      type,
      data,
      timestamp: Date.now(),
    } as BattleMessage
    this.messageCallbacks.forEach(cb => cb(message))
  }

  public getAvailableSelection(player: Player): PlayerSelection[] {
    const actions: PlayerSelection[] = [...this.getAvailableSkills(player), ...this.getAvailableSwitch(player)]
    if (actions.length == 0)
      actions.push({
        source: player,
        type: 'do-nothing',
      } as DoNothingSelection)
    return actions
  }

  public getAvailableSkills(player: Player): UseSkillSelection[] {
    return player.activePet.skills
      .filter(
        skill => skill.rageCost <= player.currentRage, // 怒气足够
      )
      .map(
        skill =>
          ({
            type: 'use-skill',
            skill,
            source: player,
            target: skill.target,
          }) as UseSkillSelection,
      )
  }

  public getAvailableSwitch(player: Player): SwitchPetSelection[] {
    return player.team
      .filter(
        pet =>
          pet !== player.activePet && // 非当前出战精灵
          pet.isAlive, // 存活状态
      )
      .map(pet => ({
        type: 'switch-pet',
        pet,
        source: player,
      }))
  }

  //TODO: 对于印记禁用的限制
  private checkSkillsActionAvailable(player: Player, selection: UseSkillSelection) {
    if (selection.type !== 'use-skill') {
      throw new Error("Invalid action type. Expected 'use-skill'.")
    }
    return selection.source.currentRage >= selection.skill.rageCost
  }

  private checkDoNothingActionAvailable(player: Player) {
    return this.getAvailableSelection(player)[0].type == 'do-nothing'
  }

  private checkSwitchAvailable(player: Player, selection: SwitchPetSelection) {
    return selection.pet !== player.activePet && selection.pet.isAlive
  }

  private getOpponent(player: Player) {
    if (player === this.playerA) return this.playerB
    return this.playerA
  }

  private addTurnRage() {
    ;[this.playerA, this.playerB].forEach(player => {
      player.currentRage = Math.min(player.currentRage + RAGE_PER_TURN, MAX_RAGE)
    })
  }

  public setSelection(player: Player, selection: PlayerSelection): boolean {
    switch (selection.type) {
      case 'use-skill':
        if (!this.checkSkillsActionAvailable(player, selection)) return false
        break
      case 'switch-pet':
        if (!this.checkSwitchAvailable(player, selection)) return false
        break
      case 'do-nothing':
        if (!this.checkDoNothingActionAvailable(player)) return false
        break
      default:
        throw '未实现的selection类型'
    }
    player.selection = selection
    return true
  }

  // 执行对战回合
  private performTurn(): boolean {
    if (!this.playerA.selection || !this.playerB.selection) throw '有人还未选择好！'

    const events: Event[] = []

    for (const selection of [this.playerA.selection, this.playerB.selection]) {
      switch (selection.type) {
        case 'use-skill': {
          const _selection = selection as UseSkillSelection
          const event: UseSkillEvent = {
            type: 'use-skill',
            source: _selection.source.activePet,
            target: _selection.skill.target,
            skill: _selection.skill,
            skillPriority: _selection.skill.priority,
            power: _selection.skill.power,
            damage: -1,
            player: selection.source,
          }
          //TODO: 触发在决定使用技能阶段影响技能效果的印记
          events.push(event)
          break
        }
        case 'switch-pet': {
          const _selection = selection as SwitchPetSelection
          const event: SwitchPetEvent = {
            type: 'switch-pet',
            player: _selection.source,
            target: _selection.pet,
          }
          events.push(event)
          break
        }
        case 'do-nothing':
          //确实啥都没干
          break
        default:
          throw '未知的event'
      }
    }
    events.sort(this.eventSort)

    this.currentRound++
    this.emitMessage(BattleMessageType.RoundStart, {
      round: this.currentRound,
    })

    eventpop: while (events.length > 0) {
      const event = events.pop()
      if (!event) break
      switch (event.type) {
        case 'use-skill': {
          const _event = event as UseSkillEvent
          if (!this.performAttack(_event)) break eventpop
          break
        }
        case 'mark-effect':
          break
        case 'switch-pet': {
          const _event = event as SwitchPetEvent
          this.performSwitchPet(_event)
          break
        }
      }
    }

    this.addTurnRage() // 每回合结束获得怒气

    // 战斗结束后重置状态
    if (this.isBattleEnded()) {
      this.status = BattleStatus.Ended
      return true
    }
    return false
  }

  private isBattleEnded(): boolean {
    // 检查强制换宠失败
    if (this.pendingDefeatedPlayer) {
      const available = this.getAvailableSwitch(this.pendingDefeatedPlayer)
      if (available.length === 0) return true
    }

    // 检查队伍存活状态
    return this.playerA.team.every(p => !p.isAlive) || this.playerB.team.every(p => !p.isAlive)
  }

  private eventSort(a: Event, b: Event): number {
    // 类型优先级：换宠 > 印记效果 > 使用技能
    const typeOrder = {
      'switch-pet': 2,
      'mark-effect': 1,
      'use-skill': 0,
    }

    // 获取类型顺序值
    const aType = a.type
    const bType = b.type

    // 类型不同时按优先级排序
    if (aType !== bType) {
      return typeOrder[aType] - typeOrder[bType]
    }

    // 同类型时比较优先级
    switch (aType) {
      case 'switch-pet':
        // 换宠始终优先
        return 1

      case 'mark-effect':
        // 比较印记效果优先级（数值大的优先）
        return (a as MarkEffectEvent).priority - (b as MarkEffectEvent).priority

      case 'use-skill': {
        const aSkill = a as UseSkillEvent
        const bSkill = b as UseSkillEvent

        // 先比较技能优先级
        if (aSkill.skillPriority !== bSkill.skillPriority) {
          return aSkill.skillPriority - bSkill.skillPriority
        }

        // 同优先级比较速度
        if (aSkill.source.stat.spd !== bSkill.source.stat.spd) {
          return aSkill.source.stat.spd - bSkill.source.stat.spd
        }

        // 速度相同,始终是a先手
        return 1
      }
    }
  }

  private performSwitchPet(event: SwitchPetEvent) {
    const player = event.player
    const newPet = event.target

    // 检查新宠物是否可用
    if (!player.team.includes(newPet) || !newPet.isAlive) {
      this.emitMessage(BattleMessageType.Error, { message: `${newPet.name} 无法出战！` })
      return
    }

    // 执行换宠
    const oldPet = player.activePet
    player.activePet = newPet
    this.emitMessage(BattleMessageType.PetSwitch, {
      player: player.name,
      fromPet: oldPet.name,
      toPet: newPet.name,
      currentHp: newPet.currentHp,
    })

    // 换宠后怒气为原怒气的80%
    this.settingRage(player, Math.floor(player.currentRage * 0.8))
  }

  private *handleForcedSwitch(player: Player): Generator<void, void, PlayerSelection> {
    // 获取可换宠列表
    const switchActions = this.getAvailableSwitch(player)
    if (switchActions.length === 0) {
      this.emitMessage(BattleMessageType.Error, { message: `${player.name} 没有可用的精灵！` })
      return
    }
    this.emitMessage(BattleMessageType.ForcedSwitch, { player: player.name, required: true })

    // 强制玩家选择换宠
    let selection: PlayerSelection
    do {
      selection = yield
      if (selection.type === 'switch-pet' && selection.source === player) {
        this.setSelection(player, selection)
      } else {
        this.emitMessage(BattleMessageType.Error, { message: '必须选择更换精灵！' })
      }
    } while (!player.selection)

    // 执行换宠
    this.performSwitchPet({
      type: 'switch-pet',
      player,
      target: (player.selection as SwitchPetSelection).pet,
    })

    // 清空选择以准备正常回合
    player.selection = null
  }

  private *handleOptionalSwitch(player: Player): Generator<void, void, PlayerSelection> {
    const switchActions = this.getAvailableSwitch(player)
    if (switchActions.length === 0) return

    this.emitMessage(BattleMessageType.KillerSwitch, { player: player.name, available: this.allowKillerSwitch })

    let selection: PlayerSelection
    do {
      selection = yield
      if (
        (selection.type === 'switch-pet' && selection.source === player) ||
        (selection.type === 'do-nothing' && selection.source === player)
      ) {
        break
      }
      this.emitMessage(BattleMessageType.InvalidAction, {
        player: player.name,
        action: selection.type,
        reason: 'invalid_action',
      })
    } while (true)

    if (selection.type === 'switch-pet') {
      this.performSwitchPet({
        type: 'switch-pet',
        player,
        target: selection.pet,
      })
    }
  }

  private performAttack(event: UseSkillEvent): boolean {
    // 攻击前触发
    const skill = event.skill
    const attacker = event.source
    const defender =
      event.skill.target === AttackTargetOpinion.opponent ? this.getOpponent(event.player).activePet : attacker // 动态获取当前目标
    if (!skill) {
      this.emitMessage(BattleMessageType.Error, { message: `${attacker.name} 没有可用技能!` })
      return false
    }
    if (attacker.currentHp <= 0 || !attacker.isAlive) return false

    this.emitMessage(BattleMessageType.SkillUse, {
      user: attacker.name,
      target: defender.name,
      skill: skill.name,
      rageCost: skill.rageCost,
    })

    // 怒气检查
    if (event.player.currentRage < skill.rageCost) {
      this.emitMessage(BattleMessageType.Error, { message: `${attacker.name} 怒气不足无法使用 ${skill.name}!` })
      return false
    }

    this.addRage(event.player, -skill.rageCost, 'skill')

    // 命中判定
    if (Math.random() > skill.accuracy) {
      this.emitMessage(BattleMessageType.SkillMiss, {
        user: attacker.name,
        target: defender.name,
        skill: skill.name,
        reason: 'accuracy',
      })
      skill.applyEffects(EffectTriggerPhase.ON_MISS, event) // 触发未命中特效
      return false
    }

    // 暴击判定
    const isCrit = Math.random() < attacker.stat.critRate
    if (isCrit) {
      this.emitMessage(BattleMessageType.Crit, { attacker: attacker.name, target: defender.name })
      skill.applyEffects(EffectTriggerPhase.ON_CRIT_PRE_DAMAGE, event) // 触发暴击前特效
    }

    // 攻击命中
    skill.applyEffects(EffectTriggerPhase.PRE_DAMAGE, event) // 触发伤害前特效

    // 伤害计算
    if (skill.SkillType !== SkillType.Status) {
      const typeMultiplier = TYPE_CHART[skill.type][defender.type] || 1
      event.damage = Math.floor(
        ((((2 * defender.level) / 5 + 2) * skill.power * (attacker.stat.atk / defender.stat.def)) / 50 + 2) *
          (Math.random() * 0.15 + 0.85) * // 随机波动
          typeMultiplier *
          (isCrit ? 1.5 : 1), // 暴击伤害
      )

      //STAB
      if (attacker.species.type === skill.type) {
        event.damage = Math.floor(event.damage * 1.5)
      }

      // TODO:对护盾类特性的特判
      defender.currentHp = Math.max(defender.currentHp - event.damage, 0)
      this.emitMessage(BattleMessageType.Damage, {
        currentHp: defender.currentHp,
        maxHp: defender.maxHp!,
        source: attacker.name,
        target: defender.name,
        damage: event.damage,
        basePower: skill.power,
        isCrit: isCrit,
        effectiveness: typeMultiplier,
        damageType:
          skill.SkillType === SkillType.Physical
            ? 'physical'
            : skill.SkillType === SkillType.Special
              ? 'special'
              : 'fixed',
      })

      // 受伤者获得怒气
      const gainedRage = Math.floor(event.damage * RAGE_PER_DAMAGE)
      this.addRage(defender.owner!, gainedRage, 'damage')

      skill.applyEffects(EffectTriggerPhase.POST_DAMAGE, event) // 触发伤害后特效

      this.addRage(event.player, 15, 'skillHit') //命中奖励
    }

    skill.applyEffects(EffectTriggerPhase.ON_HIT, event) // 触发命中特效
    if (isCrit) {
      skill.applyEffects(EffectTriggerPhase.ON_CRIT_POST_DAMAGE, event) // 触发暴击后特效
    }

    if (defender.currentHp <= 0) {
      this.emitMessage(BattleMessageType.PetDefeated, { pet: defender.name, killer: event.source.name })
      defender.isAlive = false
      skill.applyEffects(EffectTriggerPhase.ON_DEFEAT, event) // 触发击败特效

      const defeatedPlayer = defender.owner
      if (defeatedPlayer) {
        this.pendingDefeatedPlayer = defeatedPlayer
        this.lastKiller = event.player
      }
      return true
    }
    return false
  }

  private settingRage(player: Player, value: number) {
    //TODO:触发怒气相关事件
    player.currentRage = Math.max(Math.min(value, 100), 0)
  }

  private addRage(
    player: Player,
    value: number,
    reason: 'turn' | 'damage' | 'skill' | 'skillHit' | 'switch',
    ignoreRageObtainEfficiency: boolean = false,
  ) {
    let rageObtainEfficiency = player.activePet.stat.rageObtainEfficiency
    if (ignoreRageObtainEfficiency) rageObtainEfficiency = 1
    const rageDelta = value * rageObtainEfficiency
    if (rageDelta > 0) {
      //TODO: 触发和怒气增加相关的时间
    } else if (rageDelta < 0) {
      //TODO: 触发和怒气增加相关的事件
    }
    const before = player.currentRage
    this.settingRage(player, (player.currentRage += rageDelta))
    this.emitMessage(BattleMessageType.RageChange, {
      player: player.name,
      pet: player.activePet.name,
      before: before,
      after: player.currentRage,
      reason: reason,
    })
  }

  // 开始对战
  public *startBattle(): Generator<void, Player, PlayerSelection> {
    if (this.status != BattleStatus.Unstarted) throw '战斗已经开始过了！'
    this.status = BattleStatus.OnBattle
    this.emitMessage(BattleMessageType.BattleStart, {
      playerA: this.playerA.name,
      playerB: this.playerB.name,
      pets: {
        playerA: this.playerA.activePet.name,
        playerB: this.playerB.activePet.name,
      },
    })

    while (true) {
      // 阶段1：处理强制换宠
      this.currentPhase = BattlePhase.SwitchPhase
      if (this.pendingDefeatedPlayer) {
        yield* this.handleForcedSwitch(this.pendingDefeatedPlayer)
        this.pendingDefeatedPlayer = undefined
      }

      // 阶段2：击败方换宠
      if (this.allowKillerSwitch && this.lastKiller) {
        yield* this.handleOptionalSwitch(this.lastKiller)
        this.lastKiller = undefined
      }

      // 阶段3：收集玩家指令
      this.currentPhase = BattlePhase.SelectionPhase
      this.clearSelections()
      while (!this.bothPlayersReady()) {
        const selection: PlayerSelection = yield
        this.setSelection(selection.source, selection)
      }

      // 阶段4：执行回合
      this.currentPhase = BattlePhase.ExecutionPhase
      if (this.performTurn()) break
    }
    this.status = BattleStatus.Ended
    this.currentPhase = BattlePhase.Ended
    return this.getVictor()
  }

  public isInForcedSwitchPhase(): boolean {
    return !!this.pendingDefeatedPlayer
  }

  public getPendingSwitchPlayer(): Player | undefined {
    return this.pendingDefeatedPlayer
  }

  private clearSelections() {
    this.playerA.selection = null
    this.playerB.selection = null
  }

  private bothPlayersReady(): boolean {
    return !!this.playerA.selection && !!this.playerB.selection
  }

  private getVictor() {
    if (this.status != BattleStatus.Ended) throw '战斗未结束'
    if (this.playerA.team.every(pet => !pet.isAlive)) {
      this.emitMessage(BattleMessageType.BattleEnd, { winner: this.playerB.name, reason: 'all_pet_fainted' })
      return this.playerB
    } else if (this.playerB.team.every(pet => !pet.isAlive)) {
      this.emitMessage(BattleMessageType.BattleEnd, { winner: this.playerA.name, reason: 'all_pet_fainted' })
      return this.playerA
    }
    throw '不存在胜利者'
  }
}

export type PlayerSelection = UseSkillSelection | SwitchPetSelection | DoNothingSelection
export type PlayerSelections = { player: Player; selections: PlayerSelection[] }

export type UseSkillSelection = { source: Player; type: 'use-skill'; skill: Skill; target: AttackTargetOpinion }
export type SwitchPetSelection = { source: Player; type: 'switch-pet'; pet: Pet }
export type DoNothingSelection = { source: Player; type: 'do-nothing' }

export enum BattleStatus {
  Unstarted = 'Unstarted',
  OnBattle = 'On',
  Ended = 'Ended',
}

export type Event = UseSkillEvent | MarkEffectEvent | SwitchPetEvent

export type UseSkillEvent = {
  type: 'use-skill'
  player: Player
  source: Pet
  target: AttackTargetOpinion
  skill: Skill
  skillPriority: number
  power: number
  damage: number
}

export type SwitchPetEvent = {
  type: 'switch-pet'
  player: Player
  target: Pet
}

export type MarkEffectEvent = {
  type: 'mark-effect'
  source: Mark
  target: Pet | Mark
  priority: number
  damage: number
}

export type rageEvent = {
  type: 'rage-cost'
  source: Skill | Mark
  target: Player
  modifiedType: 'setting' | 'add' | 'reduce'
  value: number | [number, number]
}
