// battle/src/schemas/mark.schema.ts
// TypeBox schemas for BaseMark (prototype) and MarkInstance (entity)

import { Type, type Static } from '@sinclair/typebox'
import { StringEnum } from './utils.js'
import { StackStrategy } from '@arcadia-eternity/const'

const StackStrategyValues = Object.values(StackStrategy) as [string, ...string[]]

export const MarkConfigSchema = Type.Object({
  duration: Type.Number({ default: -1 }),
  persistent: Type.Boolean({ default: true }),
  maxStacks: Type.Number({ default: 1 }),
  stackable: Type.Boolean({ default: false }),
  stackStrategy: StringEnum(StackStrategyValues),
  destroyable: Type.Boolean({ default: true }),
  isShield: Type.Boolean({ default: false }),
  keepOnSwitchOut: Type.Boolean({ default: false }),
  transferOnSwitch: Type.Boolean({ default: false }),
  inheritOnFaint: Type.Boolean({ default: false }),
  mutexGroup: Type.Optional(Type.String()),
})

export const BaseMarkSchema = Type.Object({
  type: Type.Literal('baseMark'),
  id: Type.String(),
  iconRef: Type.Optional(Type.String()),
  config: MarkConfigSchema,
  tags: Type.Array(Type.String(), { default: [] }),
  effectIds: Type.Array(Type.String(), { default: [] }),
}, { $id: 'BaseMark' })

export const MarkSchema = Type.Object({
  type: Type.Literal('mark'),
  id: Type.String(),
  baseMarkId: Type.String(),
  ownerId: Type.Optional(Type.String()),
  ownerType: Type.Optional(StringEnum(['pet', 'battle'])),
  stack: Type.Number({ default: 1 }),
  duration: Type.Number({ default: -1 }),
  isActive: Type.Boolean({ default: true }),
  config: MarkConfigSchema,
  tags: Type.Array(Type.String(), { default: [] }),
  effectIds: Type.Array(Type.String(), { default: [] }),
  creatorId: Type.Optional(Type.String()),
}, { $id: 'Mark' })

export type MarkConfigData = Static<typeof MarkConfigSchema>
export type BaseMarkData = Static<typeof BaseMarkSchema>
export type MarkData = Static<typeof MarkSchema>
