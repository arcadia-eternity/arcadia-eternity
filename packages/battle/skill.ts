// skill.ts
import { Category } from '@test-battle/const/category'
import { AttackTargetOpinion, type baseSkillId, type skillId } from '@test-battle/const/const'
import { EffectTrigger } from '@test-battle/const/effectTrigger'
import { Element } from '@test-battle/const/element'
import { type SkillMessage } from '@test-battle/const/message'
import { EffectContext, UseSkillContext } from './context'
import { Effect, type EffectContainer } from './effect'
import { type Instance, type OwnedEntity, type Prototype } from './entity'
import { Pet } from './pet'
import { nanoid } from 'nanoid'

export class BaseSkill implements Prototype {
  public readonly effects: Effect<EffectTrigger>[] = []

  constructor(
    public readonly id: baseSkillId,
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
    public readonly sureCrit: boolean = false,
    public readonly ignoreShield: boolean = false,
    public readonly tags: string[] = [],
    effects: Effect<EffectTrigger>[] = [],
  ) {
    this.effects = effects
  }

  static Builder = class {
    #id = '' as baseSkillId
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
    #sureCrit: boolean = false
    #ignoreShield: boolean = false
    #multihit: [number, number] | number = 0
    #tags: string[] = []

    withID(id: string) {
      this.#id = id as baseSkillId
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

    setSureCrit() {
      this.#sureCrit = true
      return this
    }

    withMultihit(hit: [number, number] | number) {
      this.#multihit = hit
    }

    withTag(...arg: string[]) {
      this.#tags.push(...arg)
    }

    build() {
      return new BaseSkill(
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
        this.#sureCrit,
        this.#ignoreShield,
        this.#tags,
        this.#effects,
      )
    }
  }
}

export class SkillInstance implements EffectContainer, OwnedEntity<Pet | null>, Instance {
  public owner: Pet | null = null
  public readonly id: skillId
  public readonly category: Category
  public readonly element: Element
  public readonly power: number
  public readonly accuracy: number
  public readonly rage: number
  public readonly priority: number = 0
  public readonly target: AttackTargetOpinion = AttackTargetOpinion.opponent
  public readonly multihit: [number, number] | number = 1
  public readonly sureHit: boolean = false
  public readonly sureCrit: boolean = false
  public readonly ignoreShield: boolean = false
  public readonly tags: string[] = []
  effects: Effect<EffectTrigger>[] = []
  constructor(
    public readonly base: BaseSkill,
    overrides?: {
      power?: number
      accuracy?: number
      rage?: number
      priority?: number
      target?: AttackTargetOpinion
      multihit?: [number, number] | number
      sureHit?: boolean
      sureCrit?: boolean
      ignoreShield?: boolean
      tag?: string[]
      effects?: Effect<EffectTrigger>[]
    },
  ) {
    this.id = nanoid() as skillId
    this.category = base.category
    this.element = base.element
    this.power = overrides?.power ?? base.power
    this.accuracy = overrides?.accuracy ?? base.accuracy
    this.rage = overrides?.rage ?? base.rage
    this.priority = overrides?.priority ?? base.priority
    this.target = overrides?.target ?? base.target
    this.multihit = overrides?.multihit ?? base.multihit
    this.sureHit = overrides?.sureHit ?? base.sureHit
    this.sureCrit = overrides?.sureCrit ?? base.sureCrit
    this.ignoreShield = overrides?.ignoreShield ?? base.ignoreShield
    this.tags = overrides?.tag ? [...base.tags, ...overrides.tag] : [...base.tags]
    this.effects = [...base.effects, ...(overrides?.effects ? overrides.effects : [])]
    this.effects.forEach(effect => effect.setOwner(this))
  }

  get name() {
    return this.base.name
  }

  get baseId() {
    return this.base.id
  }

  setOwner(owner: Pet): void {
    this.owner = owner
  }

  getEffects(trigger: EffectTrigger): Effect<EffectTrigger>[] {
    return this.base.effects.filter(e => e.trigger === trigger)
  }

  collectEffects(trigger: EffectTrigger, baseContext: UseSkillContext) {
    this.base.effects
      .filter(effect => effect.trigger === trigger)
      .forEach(effect => {
        const effectContext = new EffectContext(baseContext, trigger, this)
        if (!effect.condition || effect.condition(effectContext)) {
          baseContext.battle.effectScheduler.addEffect(effect, effectContext)
        }
      })
  }

  toMessage(): SkillMessage {
    return {
      id: this.id,
      baseId: this.baseId,
      name: this.name,
      category: this.category,
      element: this.element,
      power: this.power,
      rage: this.rage,
      accuracy: this.accuracy,
      priority: this.priority,
      target: this.target,
      multihit: this.multihit,
      sureHit: this.sureHit,
      tag: this.tags,
    }
  }
}
