// skill.ts
import { Effect, type EffectContainer, EffectScheduler, EffectTrigger } from './effect'
import { EffectContext, UseSkillContext } from './context'
import { Element } from './element'
import { AttackTargetOpinion, type OwnedEntity, type Prototype } from './const'
import { Pet } from './pet'

export enum Category {
  Physical = 'Physical',
  Special = 'Special',
  Status = 'Status',
  Climax = 'Climax',
}

export class Skill implements EffectContainer, Prototype, OwnedEntity {
  private readonly effects: Effect<EffectTrigger>[] = []
  public owner: Pet | null = null

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly category: Category,
    public readonly element: Element,
    public readonly power: number,
    public readonly accuracy: number,
    public readonly rage: number,
    public readonly priority: number = 0,
    public readonly target: AttackTargetOpinion = AttackTargetOpinion.opponent,
    public readonly multihit: [number, number] | number = 1,
    public readonly sureHit: boolean = false,
    effects: Effect<EffectTrigger>[] = [],
  ) {
    this.effects = effects
    this.effects.forEach(effect => effect.setOwner(this))
  }

  setOwner(owner: Pet): void {
    this.owner = owner
  }

  getEffects(trigger: EffectTrigger): Effect<EffectTrigger>[] {
    return this.effects.filter(e => e.trigger === trigger)
  }

  collectEffects(trigger: EffectTrigger, baseContext: UseSkillContext) {
    this.effects
      .filter(effect => effect.trigger === trigger)
      .forEach(effect => {
        const effectContext = new EffectContext(baseContext, trigger, this)
        if (!effect.condition || effect.condition(effectContext)) {
          EffectScheduler.getInstance().addEffect(effect, effectContext)
        }
      })
  }

  clone(): Skill {
    return new Skill(
      this.id,
      this.name,
      this.category,
      this.element,
      this.power,
      this.accuracy,
      this.rage,
      this.priority,
      this.target,
      this.multihit,
      this.sureHit,
      this.effects,
    )
  }

  static Builder = class {
    #id = ''
    #name = 'Unnamed Skill'
    #type = Element.Normal
    #power = 0
    #accuracy = 1
    #rageCost = 0
    #target = AttackTargetOpinion.opponent
    #skillType = Category.Physical
    #effects: Effect<EffectTrigger>[] = []
    #priority: number = 0
    #sureHit: boolean = false
    #multihit: [number, number] | number = 0

    withID(id: string) {
      this.#id = id
      return this
    }

    withName(name: string) {
      this.#name = name
      return this
    }

    withType(type: Element) {
      this.#type = type
      return this
    }

    withPower(power: number) {
      this.#power = power
      return this
    }

    withAccuracy(accuracy: number) {
      this.#accuracy = accuracy
      return this
    }

    withRageCost(cost: number) {
      this.#rageCost = cost
      return this
    }

    withTarget(target: AttackTargetOpinion) {
      this.#target = target
      return this
    }

    withSkillType(type: Category) {
      this.#skillType = type
      return this
    }

    addEffect(effect: Effect<EffectTrigger>) {
      this.#effects.push(effect)
      return this
    }

    setSureHit() {
      this.#sureHit = true
      return this
    }

    withMultihit(hit: [number, number] | number) {
      this.#multihit = hit
    }

    build() {
      return new Skill(
        this.#id,
        this.#name,
        this.#skillType,
        this.#type,
        this.#power,
        this.#accuracy,
        this.#rageCost,
        this.#priority,
        this.#target,
        this.#multihit,
        this.#sureHit,
        this.#effects,
      )
    }
  }
}
