import { Category } from '@test-battle/const/category'
import {
  AttackTargetOpinion,
  type baseSkillId,
  type effectStateId,
  type entityId,
  type skillId,
} from '@test-battle/const/const'
import { EffectTrigger } from '@test-battle/const/effectTrigger'
import { Element } from '@test-battle/const/element'
import { type SkillMessage } from '@test-battle/const/message'
import { EffectContext, UseSkillContext } from './context'
import { Effect, type EffectContainer, EffectScheduler } from './effect'
import { type Instance, type OwnedEntity, type Prototype } from './entity'
import { Pet } from './pet'
import { nanoid } from 'nanoid'
import type { EffectState, EffectStateType } from '@test-battle/const'
import { PropType } from './effectBuilder'
import { SelectorType } from './effectBuilder/SelectorOpinion'

export class BaseSkill implements Prototype {
  @PropType()
  public readonly id: baseSkillId

  @PropType()
  public readonly name: string

  @PropType(SelectorType.Category)
  public readonly category: Category

  @PropType(SelectorType.Element)
  public readonly element: Element

  @PropType()
  public readonly power: number

  @PropType()
  public readonly accuracy: number

  @PropType()
  public readonly rage: number

  @PropType()
  public readonly priority: number

  @PropType(SelectorType.AttackTargetOpinion)
  public readonly target: AttackTargetOpinion

  @PropType()
  public readonly multihit: [number, number] | number

  @PropType()
  public readonly sureHit: boolean

  @PropType()
  public readonly ignoreShield: boolean

  @PropType()
  public readonly tag: string[]

  @PropType()
  public readonly effects: Effect<EffectTrigger>[]

  constructor(
    id: baseSkillId,
    name: string,
    category: Category,
    element: Element,
    power: number,
    accuracy: number,
    rage: number,
    priority: number = 0,
    target: AttackTargetOpinion = AttackTargetOpinion.opponent,
    multihit: [number, number] | number = 1,
    sureHit: boolean = false,
    ignoreShield: boolean = false,
    tag: string[] = [],
    effects: Effect<EffectTrigger>[] = [],
  ) {
    this.id = id
    this.name = name
    this.category = category
    this.element = element
    this.power = power
    this.accuracy = accuracy
    this.rage = rage
    this.priority = priority
    this.target = target
    this.multihit = multihit
    this.sureHit = sureHit
    this.ignoreShield = ignoreShield
    this.tag = tag
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
    #ignoreShield: boolean = false
    #multihit: [number, number] | number = 0
    #tag: string[] = []

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

    withMultihit(hit: [number, number] | number) {
      this.#multihit = hit
    }

    withTag(...arg: string[]) {
      this.#tag.push(...arg)
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
        this.#ignoreShield,
        this.#tag,
        this.#effects,
      )
    }
  }
}

export class SkillInstance implements EffectContainer, OwnedEntity<Pet | null>, Instance {
  @PropType()
  public owner: Pet | null = null

  @PropType()
  public readonly id: skillId

  @PropType(SelectorType.Category)
  public readonly category: Category

  @PropType(SelectorType.Element)
  public readonly element: Element

  @PropType()
  public readonly power: number

  @PropType()
  public readonly accuracy: number

  @PropType()
  public readonly rage: number

  @PropType()
  public readonly priority: number

  @PropType(SelectorType.AttackTargetOpinion)
  public readonly target: AttackTargetOpinion

  @PropType()
  public readonly multihit: [number, number] | number

  @PropType()
  public readonly sureHit: boolean

  @PropType()
  public readonly ignoreShield: boolean

  @PropType()
  public readonly tag: string[]

  public readonly effects: Effect<EffectTrigger>[]

  @PropType()
  public readonly effectsState: Map<effectStateId, EffectState<EffectStateType>>

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
    this.ignoreShield = overrides?.ignoreShield ?? base.ignoreShield
    this.tag = overrides?.tag ? [...base.tag, ...overrides.tag] : [...base.tag]
    this.effects = [...base.effects, ...(overrides?.effects ?? [])]
    this.effectsState = new Map()
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
      tag: this.tag,
    }
  }
}
