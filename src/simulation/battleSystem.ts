import { TYPE_CHART } from './type'
import { SkillType, EffectTrigger, Skill } from './skill'
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
  protected emitMessage<T extends BattleMessageType>(type: T, data: BattleMessageData[T]) {
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

    const contexts: Context[] = []

    for (const selection of [this.playerA.selection, this.playerB.selection]) {
      switch (selection.type) {
        case 'use-skill': {
          const _selection = selection as UseSkillSelection
          const context: UseSkillContext = {
            type: 'use-skill',
            battleSystem: this,
            source: _selection.source.activePet,
            selectTarget: _selection.skill.target,
            skill: _selection.skill,
            skillPriority: _selection.skill.priority,
            power: _selection.skill.power,
            rageCost: _selection.skill.rageCost,
            damageResult: -1,
            player: selection.source,
            damageModified: [100, 0],
            sureHit: _selection.skill.sureHit,
            crit: false,
          }
          //TODO: 触发在决定使用技能阶段影响技能效果的印记
          contexts.push(context)
          break
        }
        case 'switch-pet': {
          const _selection = selection as SwitchPetSelection
          const context: SwitchPetContext = {
            battleSystem: this,
            type: 'switch-pet',
            player: _selection.source,
            target: _selection.pet,
          }
          contexts.push(context)
          break
        }
        case 'do-nothing':
          //确实啥都没干
          break
        default:
          throw '未知的context'
      }
    }
    contexts.sort(this.contextSort)

    this.currentRound++
    this.emitMessage(BattleMessageType.RoundStart, {
      round: this.currentRound,
    })

    contextpop: while (contexts.length > 0) {
      const context = contexts.pop()
      if (!context) break
      switch (context.type) {
        case 'use-skill': {
          const _context = context as UseSkillContext
          if (this.performAttack(_context)) break contextpop
          break
        }
        case 'mark-effect':
          break
        case 'switch-pet': {
          const _context = context as SwitchPetContext
          this.performSwitchPet(_context)
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

  private contextSort(a: Context, b: Context): number {
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
        return (a as MarkEffectContext).priority - (b as MarkEffectContext).priority

      case 'use-skill': {
        const aSkill = a as UseSkillContext
        const bSkill = b as UseSkillContext

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

  private performSwitchPet(context: SwitchPetContext) {
    const player = context.player
    const newPet = context.target

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
    this.emitMessage(BattleMessageType.ForcedSwitch, { player: player, required: true })

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
      battleSystem: this,
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
        battleSystem: this,
        type: 'switch-pet',
        player,
        target: selection.pet,
      })
    }
  }

  private performAttack(context: UseSkillContext): boolean {
    // 攻击前触发
    const attacker = context.source
    const defender =
      context.skill.target === AttackTargetOpinion.opponent ? this.getOpponent(context.player).activePet : attacker // 动态获取当前目标
    context.actualTarget = defender
    if (!context.skill) {
      this.emitMessage(BattleMessageType.Error, { message: `${attacker.name} 没有可用技能!` })
      return false
    }
    if (attacker.currentHp <= 0 || !attacker.isAlive) return false

    this.emitMessage(BattleMessageType.SkillUse, {
      user: attacker.name,
      target: defender.name,
      skill: context.skill.name,
      rageCost: context.rageCost,
    })

    context.skill.applyEffects(this, EffectTrigger.BeforeAttack, context)

    // 怒气检查
    if (context.player.currentRage < context.rageCost) {
      this.emitMessage(BattleMessageType.Error, { message: `${attacker.name} 怒气不足无法使用 ${context.skill.name}!` })
      return false
    }

    this.addRage(context.player, -context.skill.rageCost, 'skill')

    // 命中判定
    if (Math.random() > context.skill.accuracy) {
      this.emitMessage(BattleMessageType.SkillMiss, {
        user: attacker.name,
        target: defender.name,
        skill: context.skill.name,
        reason: 'accuracy',
      })
      context.skill.applyEffects(this, EffectTrigger.OnMiss, context) // 触发未命中特效
      return false
    }

    // 暴击判定
    context.crit = Math.random() < attacker.stat.critRate
    if (context.crit) {
      this.emitMessage(BattleMessageType.Crit, { attacker: attacker.name, target: defender.name })
      context.skill.applyEffects(this, EffectTrigger.OnCritPreDamage, context) // 触发暴击前特效
    }

    // 伤害计算
    if (context.skill.skillType !== SkillType.Status) {
      // 攻击命中
      //TODO: 影响伤害的印记
      context.skill.applyEffects(this, EffectTrigger.PreDamage, context) // 触发伤害前特效
      const typeMultiplier = TYPE_CHART[context.skill.type][defender.type] || 1
      let atk = 0
      let def = 0
      switch (context.skill.skillType) {
        case SkillType.Physical:
          atk = attacker.stat.atk
          def = defender.stat.def
          break
        case SkillType.Special:
          atk = attacker.stat.spa
          def = defender.stat.spd
          break
        case SkillType.Climax:
          if (attacker.stat.atk > attacker.stat.spa) {
            atk = attacker.stat.atk
            def = defender.stat.def
          } else {
            atk = attacker.stat.spa
            def = defender.stat.spd
          }
      }
      const baseDamage = Math.floor((((2 * defender.level) / 5 + 2) * context.skill.power * (atk / def)) / 50 + 2)

      // 随机波动
      const randomFactor = Math.random() * 0.15 + 0.85

      // STAB加成
      const stabMultiplier = attacker.species.type === context.skill.type ? 1.5 : 1

      // 暴击加成
      const critMultiplier = context.crit ? 1.5 : 1

      // 应用百分比修正（叠加计算）
      const percentModifier = 1 + context.damageModified[0] / 100

      // 计算中间伤害
      let intermediateDamage = Math.floor(
        baseDamage * randomFactor * typeMultiplier * stabMultiplier * critMultiplier * percentModifier,
      )

      // 应用固定值修正
      intermediateDamage += context.damageModified[1]

      // 应用伤害阈值（先处理最小值再处理最大值）
      // 最小值阈值处理
      if (context.minThreshold) {
        intermediateDamage = Math.min(intermediateDamage, context.minThreshold)
      }

      // 最大值阈值处理
      if (context.maxThreshold) {
        intermediateDamage = Math.max(intermediateDamage, context.maxThreshold)
      }

      // 记录最终伤害
      context.damageResult = Math.max(0, intermediateDamage)

      // 应用伤害
      defender.currentHp = Math.max(defender.currentHp - context.damageResult, 0)

      this.emitMessage(BattleMessageType.Damage, {
        currentHp: defender.currentHp,
        maxHp: defender.maxHp!,
        source: attacker.name,
        target: defender.name,
        damage: context.damageResult,
        basePower: context.skill.power,
        isCrit: context.crit,
        effectiveness: typeMultiplier,
        damageType:
          context.skill.skillType === SkillType.Physical
            ? 'physical'
            : context.skill.skillType === SkillType.Special
              ? 'special'
              : 'fixed',
      })

      // 受伤者获得怒气
      const gainedRage = Math.floor(context.damageResult * RAGE_PER_DAMAGE)
      this.addRage(defender.owner!, gainedRage, 'damage')

      context.skill.applyEffects(this, EffectTrigger.PostDamage, context) // 触发伤害后特效

      this.addRage(context.player, 15, 'skillHit') //命中奖励
    }

    context.skill.applyEffects(this, EffectTrigger.OnCritPostDamage, context) // 触发命中特效
    if (context.crit) {
      context.skill.applyEffects(this, EffectTrigger.OnCritPostDamage, context) // 触发暴击后特效
    }

    if (defender.currentHp <= 0) {
      this.emitMessage(BattleMessageType.PetDefeated, { pet: defender.name, killer: context.source.name })
      defender.isAlive = false
      context.skill.applyEffects(this, EffectTrigger.OnDefeat, context) // 触发击败特效

      const defeatedPlayer = defender.owner
      if (defeatedPlayer) {
        this.pendingDefeatedPlayer = defeatedPlayer
        this.lastKiller = context.player
      }
      return true
    }
    return false
  }

  public performHeal(pet: Pet, value: number, source?: Pet, ignoreHealEfficiency: boolean = false) {
    const healObtainEfficiency = pet.stat.rageObtainEfficiency
    const effectiveHealEfficiency = ignoreHealEfficiency ? 1 : healObtainEfficiency
    const healDelta = value * effectiveHealEfficiency
    if (healDelta > 0) {
      //TODO: 触发和怒气增加相关的时间
    } else if (healDelta < 0) {
      //TODO: 触发和怒气增加相关的事件
    }
    pet.currentHp += healDelta
    this.emitMessage(BattleMessageType.Heal, {
      healer: source instanceof Skill ? source.name : undefined,
      source: source instanceof Pet ? 'skill' : 'effect',
      target: pet.name,
      amount: healDelta,
    })
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

export type Context = UseSkillContext | MarkEffectContext | SwitchPetContext

export type UseSkillContext = {
  type: 'use-skill'
  battleSystem: BattleSystem
  player: Player
  source: Pet
  selectTarget: AttackTargetOpinion
  actualTarget?: Pet
  skill: Skill
  skillPriority: number
  power: number
  rageCost: number
  damageModified: [number, number] // 百分比修正, 固定值修正
  damageResult: number
  minThreshold?: number // 最小伤害阈值数值
  maxThreshold?: number // 最大伤害阈值数值
  crit: boolean
  sureHit: boolean
}

export type SwitchPetContext = {
  type: 'switch-pet'
  battleSystem: BattleSystem
  player: Player
  target: Pet
}

export type MarkEffectContext = {
  type: 'mark-effect'
  battleSystem: BattleSystem
  source: Mark
  target: Pet | Mark
  priority: number
  damage: number
}

export type rageContext = {
  type: 'rage-cost'
  battleSystem: BattleSystem
  source: Skill | Mark
  target: Player
  modifiedType: 'setting' | 'add' | 'reduce'
  value: number | [number, number]
}
