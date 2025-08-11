// skill.ts
import {
  AttackTargetOpinion,
  Category,
  EffectTrigger,
  Element,
  IgnoreStageStrategy,
  type baseSkillId,
  type skillId,
  type SkillMessage,
} from '@arcadia-eternity/const'
import { nanoid } from 'nanoid'
import { EffectContext, UseSkillContext } from './context'
import { Effect, type EffectContainer } from './effect'
import { type Instance, type OwnedEntity, type Prototype } from './entity'
import { Pet } from './pet'
import { SkillAttributeSystem } from './attributeSystem'

export class BaseSkill implements Prototype {
  public readonly effects: Effect<EffectTrigger>[] = []

  constructor(
    public readonly id: baseSkillId,
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
    public readonly ignoreOpponentStageStrategy: IgnoreStageStrategy = IgnoreStageStrategy.none,
    public readonly tags: string[] = [],
    effects: Effect<EffectTrigger>[] = [],
  ) {
    this.effects = effects
  }

  // static Builder = class {
  //   #id = '' as baseSkillId
  //   #type = Element.Normal
  //   #power = 0
  //   #accuracy = 1
  //   #rageCost = 0
  //   #target = AttackTargetOpinion.opponent
  //   #skillType = Category.Physical
  //   #effects: Effect<EffectTrigger>[] = []
  //   #priority: number = 0
  //   #sureHit: boolean = false
  //   #sureCrit: boolean = false
  //   #ignoreShield: boolean = false
  //   #ignoreOpponentStageStrategy: IgnoreStageStrategy = IgnoreStageStrategy.none
  //   #multihit: [number, number] | number = 0
  //   #tags: string[] = []

  //   withID(id: string) {
  //     this.#id = id as baseSkillId
  //     return this
  //   }

  //   withType(type: Element) {
  //     this.#type = type
  //     return this
  //   }

  //   withPower(power: number) {
  //     this.#power = power
  //     return this
  //   }

  //   withAccuracy(accuracy: number) {
  //     this.#accuracy = accuracy
  //     return this
  //   }

  //   withRageCost(cost: number) {
  //     this.#rageCost = cost
  //     return this
  //   }

  //   withTarget(target: AttackTargetOpinion) {
  //     this.#target = target
  //     return this
  //   }

  //   withSkillType(type: Category) {
  //     this.#skillType = type
  //     return this
  //   }

  //   addEffect(effect: Effect<EffectTrigger>) {
  //     this.#effects.push(effect)
  //     return this
  //   }

  //   setSureHit() {
  //     this.#sureHit = true
  //     return this
  //   }

  //   setSureCrit() {
  //     this.#sureCrit = true
  //     return this
  //   }

  //   withMultihit(hit: [number, number] | number) {
  //     this.#multihit = hit
  //     return this
  //   }

  //   withTag(...arg: string[]) {
  //     this.#tags.push(...arg)
  //     return this
  //   }

  //   build() {
  //     return new BaseSkill(
  //       this.#id,
  //       this.#skillType,
  //       this.#type,
  //       this.#power,
  //       this.#accuracy,
  //       this.#rageCost,
  //       this.#priority,
  //       this.#target,
  //       this.#multihit,
  //       this.#sureHit,
  //       this.#sureCrit,
  //       this.#ignoreShield,
  //       this.#ignoreOpponentStageStrategy,
  //       this.#tags,
  //       this.#effects,
  //     )
  //   }
  // }
}

export class SkillInstance implements EffectContainer, OwnedEntity<Pet | null>, Instance {
  public owner: Pet | null = null
  public readonly id: skillId
  public readonly category: Category
  public readonly element: Element
  public readonly target: AttackTargetOpinion = AttackTargetOpinion.opponent
  public readonly multihit: [number, number] | number = 1
  public readonly sureHit: boolean = false
  public readonly sureCrit: boolean = false
  public readonly ignoreShield: boolean = false
  public readonly tags: string[] = []
  effects: Effect<EffectTrigger>[] = []

  // Attribute system for managing skill parameters
  public readonly attributeSystem: SkillAttributeSystem

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
    this.target = overrides?.target ?? base.target
    this.multihit = overrides?.multihit ?? base.multihit
    this.sureHit = overrides?.sureHit ?? base.sureHit
    this.sureCrit = overrides?.sureCrit ?? base.sureCrit
    this.ignoreShield = overrides?.ignoreShield ?? base.ignoreShield
    this.tags = overrides?.tag ? [...base.tags, ...overrides.tag] : [...base.tags]
    this.effects = [...base.effects, ...(overrides?.effects ? overrides.effects : [])]

    // Initialize attribute system with skill ID (battleId will be set later in setOwner)
    this.attributeSystem = new SkillAttributeSystem()

    // Initialize attribute system with skill parameters
    const power = overrides?.power ?? base.power
    const accuracy = overrides?.accuracy ?? base.accuracy
    const rage = overrides?.rage ?? base.rage
    const priority = overrides?.priority ?? base.priority

    this.attributeSystem.initializeSkillAttributes(power, accuracy, rage, priority, false)
  }

  // Compatibility properties using AttributeSystem
  get power(): number {
    return this.attributeSystem.getPower()
  }

  set power(value: number) {
    this.attributeSystem.setPower(value)
  }

  get accuracy(): number {
    return this.attributeSystem.getAccuracy()
  }

  set accuracy(value: number) {
    this.attributeSystem.setAccuracy(value)
  }

  get rage(): number {
    return this.attributeSystem.getRage()
  }

  set rage(value: number) {
    this.attributeSystem.setRage(value)
  }

  get priority(): number {
    return this.attributeSystem.getPriority()
  }

  set priority(value: number) {
    this.attributeSystem.setPriority(value)
  }

  get appeared(): boolean {
    return this.attributeSystem.getAppeared()
  }

  set appeared(value: boolean) {
    this.attributeSystem.setAppeared(value)
  }

  get baseId() {
    return this.base.id
  }

  setOwner(owner: Pet): void {
    this.owner = owner

    // Set battleId for attribute system if owner has a battle
    if (owner.owner?.battle) {
      this.attributeSystem.setBattleId(owner.owner.battle.id)
    }
  }

  getEffects(trigger: EffectTrigger): Effect<EffectTrigger>[] {
    return this.effects.filter(e => e.triggers.includes(trigger))
  }

  toMessage(viewerId?: string, showHidden = false): SkillMessage {
    const isSelf = viewerId === this.owner?.owner?.id
    const shouldShowDetails = this.appeared || isSelf || showHidden

    if (shouldShowDetails) {
      // 只有在是自己的技能或显示隐藏信息时才包含 modifier 状态
      const shouldShowModifiers = isSelf || showHidden
      const modifierState = shouldShowModifiers ? this.attributeSystem.getDetailedModifierState() : undefined

      return {
        isUnknown: false,
        id: this.id,
        baseId: this.baseId,
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
        modifierState,
      }
    }

    // 返回空占位符
    return {
      isUnknown: true,
      id: this.id,
      baseId: '' as baseSkillId,
      category: Category.Physical,
      element: Element.Normal,
      power: 0,
      rage: 0,
      accuracy: 0,
      priority: 0,
      target: AttackTargetOpinion.opponent,
      multihit: 1,
      sureHit: false,
      tag: [],
    }
  }
}
