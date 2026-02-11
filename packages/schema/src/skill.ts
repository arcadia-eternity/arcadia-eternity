import { Type, type Static } from '@sinclair/typebox'
import { ElementSchema } from './element'
import { Category, IgnoreStageStrategy } from '@arcadia-eternity/const'
import { AttackTargetOpinion } from '@arcadia-eternity/const'
import { StringEnum } from './utils'

export const CategorySchema = StringEnum(Object.values(Category))

export const AttackTargetOpinionSchema = StringEnum(
  Object.values(AttackTargetOpinion),
)

export const ignoreStageStrategySchema = StringEnum(
  Object.values(IgnoreStageStrategy),
)

export const SkillSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  element: ElementSchema,
  category: CategorySchema,
  power: Type.Integer({ minimum: 0 }),
  rage: Type.Integer({ minimum: 0 }),
  accuracy: Type.Number({ minimum: 0, maximum: 100 }),
  priority: Type.Optional(Type.Integer()),
  target: Type.Optional(AttackTargetOpinionSchema),
  multihit: Type.Optional(
    Type.Union([Type.Number(), Type.Tuple([Type.Number(), Type.Number()])]),
  ),
  sureHit: Type.Boolean({ default: false }),
  sureCrit: Type.Boolean({ default: false }),
  ignoreShield: Type.Boolean({ default: false }),
  ignoreOpponentStageStrategy: Type.Union(
    Object.values(IgnoreStageStrategy).map(v => Type.Literal(v)),
    { default: IgnoreStageStrategy.none },
  ),
  tags: Type.Array(Type.String(), { default: [] }),
  effect: Type.Optional(Type.Array(Type.String())),
})

export type SkillSchemaType = Static<typeof SkillSchema>

export const SkillDataSetSchema = Type.Array(SkillSchema)

export type SkillDataSet = Static<typeof SkillDataSetSchema>
