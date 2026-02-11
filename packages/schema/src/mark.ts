import { Type, type Static } from '@sinclair/typebox'
import { StackStrategy } from '@arcadia-eternity/const'
import { NativeEnum, parseWithErrors } from './utils'

export const StackStrategySchema = NativeEnum(StackStrategy)

export const MarkConfigSchema = Type.Object(
  {
    duration: Type.Number({ default: -1 }),
    persistent: Type.Boolean({ default: true }),
    maxStacks: Type.Integer({ default: 1 }),
    stackable: Type.Boolean({ default: false }),
    stackStrategy: Type.Union(Object.values(StackStrategy).map(v => Type.Literal(v)), {
      default: StackStrategy.extend,
    }),
    destroyable: Type.Boolean({ default: true }),
    isShield: Type.Boolean({ default: false }),
    keepOnSwitchOut: Type.Boolean({ default: false }),
    transferOnSwitch: Type.Boolean({ default: false }),
    inheritOnFaint: Type.Boolean({ default: false }),
    mutexGroup: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
)

export const MarkSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  config: Type.Optional(MarkConfigSchema),
  tags: Type.Optional(Type.Array(Type.String())),
  effect: Type.Optional(Type.Array(Type.String())),
})

export type MarkSchemaType = Static<typeof MarkSchema>

export function validateMark(data: unknown): MarkSchemaType {
  return parseWithErrors(MarkSchema, data)
}

export const MarkDataSetSchema = Type.Array(MarkSchema)

export type MarkDataSet = Static<typeof MarkDataSetSchema>
