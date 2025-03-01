import 'reflect-metadata'
import type {
  Gender,
  Element,
  Nature,
  Category,
  AttackTargetOpinion,
  StatOnBattle,
  StatTypeOnBattle,
} from '@test-battle/const'
import type {
  Pet,
  Player,
  UseSkillContext,
  DamageContext,
  Battle,
  Instance,
  MarkInstance,
  SkillInstance,
  CanOwnedEntity,
  OwnedEntity,
  Prototype,
} from '../'
import { type PropertyRef } from './selector'
import { SelectorType, type SelectorOpinion } from './SelectorOpinion'

const PROPERTY_TYPE_KEY = 'design:property:type'

export type SelectorTypeMap = {
  [SelectorType.Number]: number
  [SelectorType.String]: string
  [SelectorType.Boolean]: boolean

  [SelectorType.Gender]: Gender
  [SelectorType.Element]: Element
  [SelectorType.Nature]: Nature
  [SelectorType.Category]: Category
  [SelectorType.AttackTargetOpinion]: AttackTargetOpinion

  [SelectorType.Pet]: Pet
  [SelectorType.Player]: Player
  [SelectorType.StatOnBattle]: StatOnBattle
  [SelectorType.UseSkillContext]: UseSkillContext
  [SelectorType.DamageContext]: DamageContext
  [SelectorType.Battle]: Battle
  [SelectorType.StatTypeOnBattle]: StatTypeOnBattle
  [SelectorType.Instance]: Instance
  [SelectorType.MarkInstance]: MarkInstance
  [SelectorType.SkillInstance]: SkillInstance
  [SelectorType.Element]: Element
  [SelectorType.CanOwnedEntity]: CanOwnedEntity
  [SelectorType.OwnedEntity]: OwnedEntity
  [SelectorType.Prototype]: Prototype
  [SelectorType.PropertyRef]: PropertyRef<any, any>
  [SelectorType.Array]: SelectorOpinion[]
}
const TypeToSelectorType: Record<string, SelectorType> = {
  // 基本类型
  Number: SelectorType.Number,
  String: SelectorType.String,
  Boolean: SelectorType.Boolean,

  Gender: SelectorType.Gender,
  Element: SelectorType.Element,
  Nature: SelectorType.Nature,
  Category: SelectorType.Category,
  AttackTargetOpinion: SelectorType.AttackTargetOpinion,

  // 对象类型
  Pet: SelectorType.Pet,
  Player: SelectorType.Player,
  StatOnBattle: SelectorType.StatOnBattle,
  UseSkillContext: SelectorType.UseSkillContext,
  DamageContext: SelectorType.DamageContext,
  Battle: SelectorType.Battle,
  StatTypeOnBattle: SelectorType.StatTypeOnBattle,
  Instance: SelectorType.Instance,
  MarkInstance: SelectorType.MarkInstance,
  SkillInstance: SelectorType.SkillInstance,
  CanOwnedEntity: SelectorType.CanOwnedEntity,
  OwnedEntity: SelectorType.OwnedEntity,
  Prototype: SelectorType.Prototype,
  PropertyRef: SelectorType.PropertyRef,

  StatStage: SelectorType.StatStage,
  StatBuffOnBattle: SelectorType.StatBuffOnBattle,

  // 特殊类型
  Array: SelectorType.Array,
  Unknown: SelectorType.Unknown,
}

export function PropType(manualType?: SelectorType) {
  return function (target: any, propertyKey: string) {
    console.log(`Decorating ${target.constructor.name}.${propertyKey}`)

    if (manualType !== undefined) {
      Reflect.defineMetadata(PROPERTY_TYPE_KEY, manualType, target, propertyKey)
      return
    }

    const type = Reflect.getMetadata('design:type', target, propertyKey)
    console.log(`Inferred type for ${propertyKey}:`, type?.name)

    const selectorType = TypeToSelectorType[type?.name] || SelectorType.Unknown
    Reflect.defineMetadata(PROPERTY_TYPE_KEY, selectorType, target, propertyKey)
  }
}
