import { Pet } from './pet'
import { Type } from './type'

export enum EffectTriggerPhase {
  PRE_DAMAGE = 'PRE_DAMAGE',
  POST_DAMAGE = 'POST_DAMAGE',
  ON_HIT = 'ON_HIT',
  ON_CRIT_PRE_DAMAGE = 'ON_CRIT_PRE_DAMAGE',
  ON_CRIT_POST_DAMAGE = 'ON_CRIT_POST_DAMAGE',
  ON_MISS = 'ON_MISS',
  ON_DEFEAT = 'ON_DEFEAT',
}

export interface SkillEffect {
  phase: EffectTriggerPhase
  apply(attacker: Pet, target: Pet, skill: Skill, damage?: number): void
  probability?: number // 触发概率（0-1）
}

export enum SkillType {
  Physical = 'Physical',
  Special = 'Special',
  Status = 'Status',
  Climax = 'Climax',
}

// 技能类
export class Skill {
  public readonly effects: SkillEffect[]
  constructor(
    public readonly name: string,
    public readonly SkillType: SkillType,
    public readonly type: Type,
    public readonly power: number,
    public readonly accuracy: number,
    public readonly rageCost: number, // 新增怒气消耗
    effects?: SkillEffect[], // 可选特效
  ) {
    this.effects = effects || []
  }

  public applyEffects(EffectTriggerPhase: EffectTriggerPhase, attacker: Pet, target: Pet, damage?: number) {
    this.effects
      .filter(effect => effect.phase === EffectTriggerPhase)
      .forEach(effect => {
        if (Math.random() < (effect.probability ?? 1)) {
          effect.apply(attacker, target, this, damage)
        }
      })
  }

  static builder() {
    return new SkillBuilder()
  }
}

class SkillBuilder {
  private name = ''
  private SkillType = SkillType.Physical
  private type = Type.Normal
  private power = 0
  private accuracy = 1
  private rageCost = 0
  private effects: SkillEffect[] = []

  withName(name: string) {
    this.name = name
    return this
  }

  withType(type: Type) {
    this.type = type
    return this
  }

  withPower(power: number) {
    this.power = power
    return this
  }

  withAccuracy(accuracy: number) {
    this.accuracy = accuracy
    return this
  }

  withRageCost(rageCost: number) {
    this.rageCost = rageCost
    return this
  }

  withEffect(effect: SkillEffect) {
    this.effects.push(effect)
    return this
  }

  build() {
    return new Skill(this.name, this.SkillType, this.type, this.power, this.accuracy, this.rageCost, this.effects)
  }
}
