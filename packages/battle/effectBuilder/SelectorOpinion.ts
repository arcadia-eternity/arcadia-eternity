import type {
  Element,
  Gender,
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
import type { PropertyRef } from './selector'

export enum SelectorType {
  // 基本类型
  Number = 'Number',
  String = 'String',
  Boolean = 'Boolean',

  // 枚举类型
  Gender = 'Gender',
  Element = 'Element',
  Nature = 'Nature',
  Category = 'Category',
  AttackTargetOpinion = 'AttackTargetOpinion',

  // 对象类型
  Pet = 'Pet',
  Player = 'Player',
  StatOnBattle = 'StatOnBattle',
  UseSkillContext = 'UseSkillContext',
  DamageContext = 'DamageContext',
  Battle = 'Battle',
  StatTypeOnBattle = 'StatTypeOnBattle',
  Instance = 'Instance',
  MarkInstance = 'MarkInstance',
  SkillInstance = 'SkillInstance',
  CanOwnedEntity = 'CanOwnedEntity',
  OwnedEntity = 'OwnedEntity',
  Prototype = 'Prototype',
  PropertyRef = 'PropertyRef',

  StatStage = 'StatStage',
  StatBuffOnBattle = 'StatBuffOnBattle',

  // 特殊类型
  Array = 'Array',
  Unknown = 'Unknown',
}

export type PrimitiveOpinion = number | string | boolean

export type EnumOpinion = Element | Gender | Nature | Category | AttackTargetOpinion

export type ObjectOpinion =
  | null
  | Pet
  | Player
  | StatOnBattle
  | UseSkillContext
  | DamageContext
  | Battle
  | StatTypeOnBattle
  | Instance
  | MarkInstance
  | SkillInstance
  | CanOwnedEntity
  | OwnedEntity
  | Prototype
  | PropertyRef<any, any>

export type SelectorOpinion = PrimitiveOpinion | ObjectOpinion | EnumOpinion | Array<SelectorOpinion>
