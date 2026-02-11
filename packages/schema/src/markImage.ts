import { Type, type Static } from '@sinclair/typebox'

export const MarkImageSchema = Type.Record(Type.String(), Type.String({ format: 'uri' }))

export type MarkImageSchemaType = Static<typeof MarkImageSchema>
