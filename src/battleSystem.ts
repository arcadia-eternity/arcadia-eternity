import { TYPE_CHART } from './type'
import { SkillType, EffectTriggerPhase, Skill } from './skill'
import { Pet } from './pet'
import { MAX_RAGE, RAGE_PER_TURN, RAGE_PER_DAMAGE } from './const'

export class Player {
  constructor(
    public readonly name: string,
    public activePet: Pet,
    public readonly team: Pet[],
  ) {}
}

// 对战系统
export class BattleSystem {
  private currentRound = 0
  constructor(
    public readonly playerA: Player,
    public readonly playerB: Player,
    private readonly ui: BattleUI,
  ) {}

  private generateAvailableActions(player: Player): PlayerAction[] {
    const actions = [
      // 1. 可用技能
      ...this.getAvailableSkills(player),
      // 3. 可换精灵
      ...this.getSwitchActions(player),
    ]
    if (actions.length > 0) return actions
    return [{ source: player, type: 'do-nothing' }]
  }

  private getAvailableSkills(player: Player): PlayerAction[] {
    return player.activePet.skills
      .filter(
        skill => skill.rageCost <= player.activePet.currentRage, // 怒气足够
      )
      .map(skill => ({
        type: 'use-skill',
        skill,
        source: player,
      }))
  }

  private getSwitchActions(player: Player): PlayerAction[] {
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

  // 判断先攻顺序
  private getAttackOrder(): [Pet, Pet] {
    if (this.playerA.activePet.stat.spd === this.playerB.activePet.stat.spd) {
      return Math.random() > 0.5
        ? [this.playerA.activePet, this.playerB.activePet]
        : [this.playerB.activePet, this.playerA.activePet]
    }
    return this.playerA.activePet.stat.spd > this.playerB.activePet.stat.spd
      ? [this.playerA.activePet, this.playerB.activePet]
      : [this.playerB.activePet, this.playerA.activePet]
  }

  private getOpponent(player: Player) {
    if (player === this.playerA) return this.playerB
    return this.playerA
  }

  private addTurnRage() {
    ;[this.playerA.activePet, this.playerB.activePet].forEach(pet => {
      const before = pet.currentRage
      pet.currentRage = Math.min(pet.currentRage + RAGE_PER_TURN, MAX_RAGE)
      console.log(`${pet.name} 获得${RAGE_PER_TURN}怒气 (${before}→${pet.currentRage})`)
    })
  }

  // 执行对战回合
  private async performTurn(): Promise<boolean> {
    this.currentRound++
    this.ui.showMessage(`\n=== 第 ${this.currentRound} 回合 ===`)

    this.ui.showMessage('回合开始！')

    const [availableActionsA, availableActionsB] = [
      this.generateAvailableActions(this.playerA),
      this.generateAvailableActions(this.playerB),
    ]

    const [actionA, actionB] = await this.ui.getPlayersActions(
      this.playerA,
      availableActionsA,
      this.playerB,
      availableActionsB,
    )

    const results = await this.executeActions(actionA, actionB)

    this.addTurnRage() // 每回合结束获得怒气
    return results.some(r => r.targetDefeated)
  }

  private async executeActions(
    actionA: PlayerAction,
    actionB: PlayerAction,
  ): Promise<{ source: Player; targetDefeated: boolean }[]> {
    // 根据速度决定执行顺序
    const first = this.getActionOrder(actionA, actionB)
    const results = []

    for (const action of [first.fast, first.slow]) {
      if (!action.source.activePet?.isAlive) continue

      const result = await this.handleSingleAction(action, this.getOpponent(action.source).activePet)
      results.push(result)

      if (result.targetDefeated) break // 有宝可梦倒下则终止回合
    }

    return results
  }

  private getActionOrder(a: PlayerAction, b: PlayerAction) {
    const speedA = a.source.activePet.stat.spd
    const speedB = b.source.activePet.stat.spd

    if (speedA === speedB) {
      return Math.random() > 0.5 ? { fast: a, slow: b } : { fast: b, slow: a }
    }
    return speedA > speedB ? { fast: a, slow: b } : { fast: b, slow: a }
  }

  private async handleSingleAction(action: PlayerAction, target: Pet) {
    const targetPlayer = action.source === this.playerA ? this.playerB : this.playerA
    let targetDefeated = false

    switch (action.type) {
      case 'use-skill':
        this.ui.showMessage(`${action.source.name} 的 ${action.source.activePet.name} 使用 ${action.skill.name}！`)
        this.performAttack(action.source.activePet, target, action.skill)
        targetDefeated = !targetPlayer.activePet.isAlive
        break
      case 'do-nothing':
        this.ui.showMessage(`${action.source.name} 无法行动！`)
    }

    return { source: action.source, targetDefeated }
  }

  private performAttack(attacker: Pet, defender: Pet, skill: Skill) {
    // 攻击前触发
    if (!skill) {
      console.log(`${attacker.name} 没有可用技能!`)
      return false
    }
    if (attacker.currentHp <= 0) return

    console.log(`${attacker.name} 使用 ${skill.name}！`)

    // 怒气检查
    if (attacker.currentRage < skill.rageCost) {
      console.log(`${attacker.name} 怒气不足无法使用 ${skill.name}!`)
      return
    }

    console.log(`${attacker.name} 使用 ${skill.name} (消耗${skill.rageCost}怒气)!`)
    attacker.currentRage -= skill.rageCost

    // 命中判定
    if (Math.random() > skill.accuracy) {
      console.log(`${attacker.name} 的攻击没有命中！`)
      skill.applyEffects(EffectTriggerPhase.ON_MISS, attacker, defender) // 触发未命中特效
      return
    }

    // 暴击判定
    const isCrit = Math.random() < attacker.stat.critRate
    if (isCrit) {
      console.log('暴击！')
      skill.applyEffects(EffectTriggerPhase.ON_CRIT_PRE_DAMAGE, attacker, defender) // 触发暴击前特效
    }

    // 攻击命中
    skill.applyEffects(EffectTriggerPhase.PRE_DAMAGE, attacker, defender) // 触发伤害前特效

    // 伤害计算
    if (skill.SkillType !== SkillType.Status) {
      const typeMultiplier = TYPE_CHART[skill.type][defender.type] || 1
      let damage = Math.floor(
        ((((2 * defender.level) / 5 + 2) * skill.power * (attacker.stat.atk / defender.stat.def)) / 50 + 2) *
          (Math.random() * 0.15 + 0.85) * // 随机波动
          typeMultiplier *
          (isCrit ? 1.5 : 1), // 暴击伤害
      )

      //STAB
      if (attacker.species.type === skill.type) {
        damage = Math.floor(damage * 1.5)
      }

      // 应用伤害
      defender.currentHp = Math.max(defender.currentHp - damage, 0)
      console.log(`${defender.name} 受到了 ${damage} 点伤害！`)
      if (typeMultiplier > 1) console.log('效果拔群！')
      if (typeMultiplier < 1) console.log('效果不佳...')

      // 受伤者获得怒气
      const gainedRage = Math.floor(damage * RAGE_PER_DAMAGE)
      defender.currentRage = Math.min(defender.currentRage + gainedRage, MAX_RAGE)
      console.log(`${defender.name} 因受伤获得${gainedRage}怒气`)

      skill.applyEffects(EffectTriggerPhase.POST_DAMAGE, attacker, defender) // 触发伤害后特效
    }

    skill.applyEffects(EffectTriggerPhase.ON_HIT, attacker, defender) // 触发命中特效
    if (isCrit) {
      skill.applyEffects(EffectTriggerPhase.ON_CRIT_POST_DAMAGE, attacker, defender) // 触发暴击后特效
    }

    if (defender.currentHp <= 0) {
      console.log(`${defender.name} 倒下了！`)
      skill.applyEffects(EffectTriggerPhase.ON_DEFEAT, attacker, defender) // 触发击败特效
    }
  }

  // 开始对战
  async startBattle(): Promise<void> {
    console.log(`对战开始：${this.playerA.activePet.name} vs ${this.playerB.activePet.name}!`)

    while (this.playerA.activePet.currentHp > 0 && this.playerB.activePet.currentHp > 0) {
      console.log('\n====================')
      console.log(
        `${this.playerA.activePet.name} HP: ${this.playerA.activePet.currentHp} / ${this.playerA.activePet.maxHp} (${this.playerA.activePet.currentRage} Rage)`,
      ) // 显示当前血量和怒气
      console.log(
        `${this.playerB.activePet.name} HP: ${this.playerB.activePet.currentHp} / ${this.playerB.activePet.maxHp} (${this.playerB.activePet.currentRage} Rage)`,
      ) // 显示当前血量和怒气
      if (await this.performTurn()) break
    }

    const winner = this.playerA.activePet.currentHp > 0 ? this.playerA.activePet : this.playerB.activePet
    console.log(`\n${winner.name} 获得了胜利！`)
  }
}

export type PlayerAction =
  | { source: Player; type: 'use-skill'; skill: Skill }
  | { source: Player; type: 'switch-pet'; pet: Pet }
  | { source: Player; type: 'do-nothing' }

export interface BattleUI {
  showMessage(msg: string): void
  getPlayersActions(
    player1: Player,
    player1Actions: PlayerAction[],
    player2: Player,
    player2Actions: PlayerAction[],
  ): Promise<[PlayerAction, PlayerAction]>
}
