// skill.ts
import { Effect, EffectContainer, EffectScheduler, EffectTrigger } from './effect'
import { EffectContext, UseSkillContext } from './context'
import { Type } from './type'
import { AttackTargetOpinion, OwnedEntity, Prototype } from './const'
import { Pet } from './pet'

export enum SkillType {
  Physical = 'Physical',
  Special = 'Special',
  Status = 'Status',
  Climax = 'Climax',
}

export class Skill implements EffectContainer, Prototype, OwnedEntity {
  private readonly effects: Effect[] = []
  public owner: Pet | null = null

  constructor(
    public readonly id: string,
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
    this.effects.forEach(effect => effect.setOwner(this))
  }

  setOwner(owner: Pet): void {
    this.owner = owner
  }

  getEffects(trigger: EffectTrigger): Effect[] {
    return this.effects.filter(e => e.trigger === trigger)
  }

  collectEffects(trigger: EffectTrigger, baseContext: UseSkillContext) {
    this.effects
      .filter(effect => effect.trigger === trigger)
      .forEach(effect => {
        const effectContext = new EffectContext(baseContext, this)
        if (!effect.condition || effect.condition(effectContext)) {
          EffectScheduler.getInstance().addEffect(effect, effectContext)
        }
      })
  }

  clone(): Skill {
    return new Skill(
      this.id,
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

  static Builder = class {
    private id = 'Unnamed'
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
        this.id,
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
