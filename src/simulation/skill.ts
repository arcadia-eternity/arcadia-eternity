// skill.ts
import { Effect, EffectContainer, EffectTrigger, EffectApplicator } from './effect'
import { EffectContext } from './context'
import { Type } from './type'
import { AttackTargetOpinion } from './const'
import { BattleSystem } from './battleSystem'
import { UseSkillContext } from './context'

export enum SkillType {
  Physical = 'Physical',
  Special = 'Special',
  Status = 'Status',
  Climax = 'Climax',
}

export class Skill implements EffectContainer {
  private effects: Effect[] = []

  constructor(
    public readonly name: string,
    public readonly skillType: SkillType,
    public readonly type: Type,
    public readonly power: number,
    public readonly accuracy: number,
    public readonly rageCost: number,
    public readonly priority: number = 0,
    public readonly target: AttackTargetOpinion = AttackTargetOpinion.opponent,
    public readonly sureHit: boolean = false,
    effects: Effect[] = [],
  ) {
    this.effects = effects
  }

  getEffects(trigger: EffectTrigger): Effect[] {
    return this.effects.filter(e => e.trigger === trigger)
  }

  applyEffects(battle: BattleSystem, trigger: EffectTrigger, context: UseSkillContext) {
    const effectContext: EffectContext = {
      type: 'effect',
      battle: battle,
      parent: context,
      owner: context.pet,
    }
    EffectApplicator.apply(this, trigger, effectContext)
  }

  static Builder = class {
    private name = 'Unnamed Skill'
    private type = Type.Normal
    private power = 0
    private accuracy = 1
    private rageCost = 0
    private target = AttackTargetOpinion.opponent
    private skillType = SkillType.Physical
    private effects: Effect[] = []
    private priority: number = 0
    private sureHit: boolean = false

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

    withRageCost(cost: number) {
      this.rageCost = cost
      return this
    }

    withTarget(target: AttackTargetOpinion) {
      this.target = target
      return this
    }

    withSkillType(type: SkillType) {
      this.skillType = type
      return this
    }

    addEffect(effect: Effect) {
      this.effects.push(effect)
      return this
    }

    setSureHit() {
      this.sureHit = true
    }

    build() {
      return new Skill(
        this.name,
        this.skillType,
        this.type,
        this.power,
        this.accuracy,
        this.rageCost,
        this.priority,
        this.target,
        this.sureHit,
        this.effects,
      )
    }
  }
}
export { EffectTrigger }
