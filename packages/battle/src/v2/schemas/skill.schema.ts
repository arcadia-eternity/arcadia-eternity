// battle/src/schemas/skill.schema.ts
// TypeBox schemas for BaseSkill (prototype) and SkillInstance (entity)

import { Type, type Static } from '@sinclair/typebox'
import { StringEnum } from './utils.js'
import {
  Category,
  Element,
  AttackTargetOpinion,
  IgnoreStageStrategy,
} from '@arcadia-eternity/const'

const CategoryValues = Object.values(Category) as [string, ...string[]]
const ElementValues = Object.values(Element) as [string, ...string[]]
const TargetValues = Object.values(AttackTargetOpinion) as [string, ...string[]]
const IgnoreStageValues = Object.values(IgnoreStageStrategy) as [string, ...string[]]

export const MultihitSchema = Type.Union([
  Type.Tuple([Type.Number(), Type.Number()]),
  Type.Number(),
])

export const BaseSkillSchema = Type.Object({
  type: Type.Literal('baseSkill'),
  id: Type.String(),
  sfxRef: Type.Optional(Type.String()),
  category: StringEnum(CategoryValues),
  element: StringEnum(ElementValues),
  power: Type.Number(),
  accuracy: Type.Number(),
  rage: Type.Number(),
  priority: Type.Number({ default: 0 }),
  target: StringEnum(TargetValues),
  multihit: MultihitSchema,
  sureHit: Type.Boolean({ default: false }),
  sureCrit: Type.Boolean({ default: false }),
  ignoreShield: Type.Boolean({ default: false }),
  ignoreOpponentStageStrategy: StringEnum(IgnoreStageValues),
  tags: Type.Array(Type.String(), { default: [] }),
  effectIds: Type.Array(Type.String(), { default: [] }),
}, { $id: 'BaseSkill' })

export const SkillSchema = Type.Object({
  type: Type.Literal('skill'),
  id: Type.String(),
  baseSkillId: Type.String(),
  ownerId: Type.Optional(Type.String()),
  category: StringEnum(CategoryValues),
  element: StringEnum(ElementValues),
  target: StringEnum(TargetValues),
  multihit: MultihitSchema,
  sureHit: Type.Boolean({ default: false }),
  sureCrit: Type.Boolean({ default: false }),
  ignoreShield: Type.Boolean({ default: false }),
  tags: Type.Array(Type.String(), { default: [] }),
  effectIds: Type.Array(Type.String(), { default: [] }),
  appeared: Type.Boolean({ default: false }),
}, { $id: 'Skill' })

export type BaseSkillData = Static<typeof BaseSkillSchema>
export type SkillData = Static<typeof SkillSchema>
