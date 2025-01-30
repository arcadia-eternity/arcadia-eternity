import { Type, TYPE_CHART } from './type'
import { Skill, SkillType, EffectTriggerPhase } from './skill'
import { Pet } from './pet'
import { Mark, TriggerCondition } from './mark'

// 新增怒气相关配置
const MAX_RAGE = 100
const RAGE_PER_TURN = 15
const RAGE_PER_DAMAGE = 0.5

// 对战系统
export class BattleSystem {
  constructor(
    public readonly petA: Pet,
    public readonly petB: Pet,
  ) {}

  // 判断先攻顺序
  getAttackOrder(): [Pet, Pet] {
    if (this.petA.speed === this.petB.speed) {
      return Math.random() > 0.5 ? [this.petA, this.petB] : [this.petB, this.petA]
    }
    return this.petA.speed > this.petB.speed ? [this.petA, this.petB] : [this.petB, this.petA]
  }

  private addTurnRage() {
    ;[this.petA, this.petB].forEach(pet => {
      const before = pet.currentRage
      pet.currentRage = Math.min(pet.currentRage + RAGE_PER_TURN, MAX_RAGE)
      console.log(`${pet.name} 获得${RAGE_PER_TURN}怒气 (${before}→${pet.currentRage})`)
    })
  }

  // 执行对战回合
  performTurn(): boolean {
    this.triggerGlobal(TriggerCondition.ROUND_START) // 触发回合开始效果

    const [attacker, defender] = this.getAttackOrder()

    // 第一只攻击
    this.performAttack(attacker, defender)
    if (defender.currentHp <= 0) return true

    // 第二只反击
    this.performAttack(defender, attacker)
    if (attacker.currentHp <= 0) return true

    this.triggerGlobal(TriggerCondition.ROUND_END) // 触发回合结束效果
    ;[this.petA, this.petB].forEach(p => p.updateRoundMarks()) // 更新回合型印记
    if (attacker.currentHp <= 0 || defender.currentHp <= 0) return true

    this.addTurnRage() // 每回合结束获得怒气
    return false
  }

  private performAttack(attacker: Pet, defender: Pet) {
    // 攻击前触发
    attacker.triggerMarks(TriggerCondition.BEFORE_ATTACK, attacker)
    const skill = attacker.selectRandomSkill()
    if (!skill) {
      console.log(`${attacker.name} 没有可用技能!`)
      return false
    }
    // attacker.attackTarget(defender, skill);
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
    const isCrit = Math.random() < attacker.critRate
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
        ((((2 * defender.level) / 5 + 2) * skill.power * (attacker.attack / defender.defense)) / 50 + 2) *
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

      // 受伤者触发效果
      defender.triggerMarks(TriggerCondition.AFTER_DAMAGED, attacker, damage)

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

  private triggerGlobal(condition: TriggerCondition): void {
    ;[this.petA, this.petB].forEach(p => {
      p.triggerMarks(condition)
    })
  }

  // 开始对战
  startBattle(): void {
    console.log(`对战开始：${this.petA.name} vs ${this.petB.name}!`)
    this.triggerGlobal(TriggerCondition.ROUND_START) // 触发回合开始效果
    let turn = 1

    while (this.petA.currentHp > 0 && this.petB.currentHp > 0) {
      console.log('\n====================')
      console.log(`${this.petA.name} HP: ${this.petA.currentHp} / ${this.petA.maxHp} (${this.petA.currentRage} Rage)`) // 显示当前血量和怒气
      console.log(`印记状态: ${this.petA.markStatus}`) // 显示印记状态
      console.log(`${this.petB.name} HP: ${this.petB.currentHp} / ${this.petB.maxHp} (${this.petB.currentRage} Rage)`) // 显示当前血量和怒气
      console.log(`印记状态: ${this.petB.markStatus}`) // 显示印记状态
      console.log(`\n=== 第 ${turn} 回合 ===`)
      if (this.performTurn()) break
      turn++
    }

    const winner = this.petA.currentHp > 0 ? this.petA : this.petB
    console.log(`\n${winner.name} 获得了胜利！`)
  }
}
