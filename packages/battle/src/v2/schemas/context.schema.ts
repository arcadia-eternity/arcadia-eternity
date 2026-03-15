// battle/src/schemas/context.schema.ts
// TypeBox schemas for battle contexts (UseSkill, Damage, Heal, etc.)
// These are the serializable data representations of game events.

import { Type, type Static } from '@sinclair/typebox'
import { StringEnum } from './utils.js'
import {
  Category,
  DamageType,
  AttackTargetOpinion,
  IgnoreStageStrategy,
  StackStrategy,
} from '@arcadia-eternity/const'

const CategoryValues = Object.values(Category) as [string, ...string[]]
const DamageTypeValues = Object.values(DamageType) as [string, ...string[]]
const TargetValues = Object.values(AttackTargetOpinion) as [string, ...string[]]
const IgnoreStageValues = Object.values(IgnoreStageStrategy) as [string, ...string[]]
const StackStrategyValues = Object.values(StackStrategy) as [string, ...string[]]

export const UseSkillContextSchema = Type.Object({
  type: Type.Literal('use-skill'),
  parentId: Type.String(),
  petId: Type.String(),
  skillId: Type.String(),
  originPlayerId: Type.String(),
  selectTarget: StringEnum(TargetValues),
  priority: Type.Number(),
  category: StringEnum(CategoryValues),
  element: Type.String(),
  power: Type.Number({ default: 0 }),
  accuracy: Type.Number({ default: 100 }),
  petAccuracy: Type.Number({ default: 100 }),
  rage: Type.Number({ default: 0 }),
  evasion: Type.Number({ default: 0 }),
  critRate: Type.Number({ default: 7 }),
  ignoreShield: Type.Boolean({ default: false }),
  ignoreStageStrategy: StringEnum(IgnoreStageValues),
  multihit: Type.Union([Type.Tuple([Type.Number(), Type.Number()]), Type.Number()]),
  available: Type.Boolean({ default: true }),
  actualTargetId: Type.Optional(Type.String()),
  hitResult: Type.Boolean({ default: false }),
  crit: Type.Boolean({ default: false }),
  multihitResult: Type.Number({ default: 1 }),
  currentHitCount: Type.Number({ default: 1 }),
  damageType: StringEnum(DamageTypeValues),
  typeMultiplier: Type.Number({ default: 1 }),
  stabMultiplier: Type.Number({ default: 1.5 }),
  critMultiplier: Type.Number({ default: 2 }),
  baseDamage: Type.Number({ default: 0 }),
  randomFactor: Type.Number({ default: 1 }),
  defeated: Type.Boolean({ default: false }),
}, { $id: 'UseSkillContext' })

export const DamageContextSchema = Type.Object({
  type: Type.Literal('damage'),
  parentId: Type.String(),
  sourceId: Type.String(),
  targetId: Type.String(),
  baseDamage: Type.Number(),
  damageType: StringEnum(DamageTypeValues),
  crit: Type.Boolean({ default: false }),
  effectiveness: Type.Number({ default: 1 }),
  ignoreShield: Type.Boolean({ default: false }),
  randomFactor: Type.Number({ default: 1 }),
  modified: Type.Tuple([Type.Number(), Type.Number()], { default: [0, 0] }),
  minThreshold: Type.Number({ default: 0 }),
  maxThreshold: Type.Number({ default: Number.MAX_SAFE_INTEGER }),
  damageResult: Type.Number({ default: 0 }),
  available: Type.Boolean({ default: true }),
  element: Type.Optional(Type.String()),
}, { $id: 'DamageContext' })

export const HealContextSchema = Type.Object({
  type: Type.Literal('heal'),
  parentId: Type.String(),
  sourceId: Type.String(),
  targetId: Type.String(),
  baseHeal: Type.Number(),
  ignoreEffect: Type.Boolean({ default: false }),
  modified: Type.Tuple([Type.Number(), Type.Number()], { default: [0, 0] }),
  healResult: Type.Number({ default: 0 }),
  available: Type.Boolean({ default: true }),
}, { $id: 'HealContext' })

export const RageContextSchema = Type.Object({
  type: Type.Literal('rage'),
  parentId: Type.String(),
  targetPlayerId: Type.String(),
  reason: StringEnum(['turn', 'damage', 'skill', 'skillHit', 'switch', 'effect']),
  modifiedType: StringEnum(['setting', 'add', 'reduce']),
  value: Type.Number(),
  ignoreRageObtainEfficiency: Type.Boolean({ default: false }),
  modified: Type.Tuple([Type.Number(), Type.Number()], { default: [0, 0] }),
  rageChangeResult: Type.Number({ default: 0 }),
  available: Type.Boolean({ default: true }),
}, { $id: 'RageContext' })

export const AddMarkContextSchema = Type.Object({
  type: Type.Literal('add-mark'),
  parentId: Type.String(),
  targetId: Type.String(),
  baseMarkId: Type.String(),
  baseMark: Type.Optional(Type.Any()),
  stack: Type.Number(),
  duration: Type.Number(),
  config: Type.Optional(Type.Any()),
  configOverride: Type.Optional(Type.Any()),
  statLevelMarkLevel: Type.Optional(Type.Number()),
  creatorId: Type.Optional(Type.String()),
  available: Type.Boolean({ default: true }),
}, { $id: 'AddMarkContext' })

export const RemoveMarkContextSchema = Type.Object({
  type: Type.Literal('remove-mark'),
  parentId: Type.String(),
  markId: Type.String(),
  available: Type.Boolean({ default: true }),
}, { $id: 'RemoveMarkContext' })

export const SwitchPetContextSchema = Type.Object({
  type: Type.Literal('switch-pet'),
  parentId: Type.String(),
  originPlayerId: Type.String(),
  switchInPetId: Type.String(),
  switchOutPetId: Type.Optional(Type.String()),
}, { $id: 'SwitchPetContext' })

export const StackContextSchema = Type.Object({
  type: Type.Literal('stack'),
  parentId: Type.String(),
  existingMarkId: Type.String(),
  incomingMarkId: Type.String(),
  stacksBefore: Type.Number(),
  durationBefore: Type.Number(),
  stacksAfter: Type.Number(),
  durationAfter: Type.Number(),
  stackStrategy: StringEnum(StackStrategyValues),
  available: Type.Boolean({ default: true }),
}, { $id: 'StackContext' })

export const ConsumeStackContextSchema = Type.Object({
  type: Type.Literal('consumeStack'),
  parentId: Type.String(),
  markId: Type.String(),
  requestedAmount: Type.Number(),
  actualAmount: Type.Number({ default: 0 }),
  available: Type.Boolean({ default: true }),
}, { $id: 'ConsumeStackContext' })

export const TransformContextSchema = Type.Object({
  type: Type.Literal('transform'),
  parentId: Type.String(),
  targetId: Type.String(),
  targetType: StringEnum(['pet', 'skill', 'mark']),
  fromBaseId: Type.String(),
  toBaseId: Type.String(),
  transformType: StringEnum(['temporary', 'permanent']),
  priority: Type.Number({ default: 0 }),
  causedById: Type.Optional(Type.String()),
  available: Type.Boolean({ default: true }),
}, { $id: 'TransformContext' })

export const TurnContextSchema = Type.Object({
  type: Type.Literal('turn'),
  parentId: Type.String(),
  contextIds: Type.Array(Type.String(), { default: [] }),
}, { $id: 'TurnContext' })

// Export types
export type UseSkillContextData = Static<typeof UseSkillContextSchema>
export type DamageContextData = Static<typeof DamageContextSchema>
export type HealContextData = Static<typeof HealContextSchema>
export type RageContextData = Static<typeof RageContextSchema>
export type AddMarkContextData = Static<typeof AddMarkContextSchema>
export type RemoveMarkContextData = Static<typeof RemoveMarkContextSchema>
export type SwitchPetContextData = Static<typeof SwitchPetContextSchema>
export type StackContextData = Static<typeof StackContextSchema>
export type ConsumeStackContextData = Static<typeof ConsumeStackContextSchema>
export type TransformContextData = Static<typeof TransformContextSchema>
export type TurnContextData = Static<typeof TurnContextSchema>
