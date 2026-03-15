import { PetSchema } from './pet'
import { nanoid } from 'nanoid'
import { Type, type Static } from '@sinclair/typebox'

const NANOID_PATTERN = '^[A-Za-z0-9_-]{21}$'

export const PlayerSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  id: Type.String({ pattern: NANOID_PATTERN, default: nanoid() }),
  team: Type.Array(PetSchema, { minItems: 1, maxItems: 6 }), //约定：位于第一位的为首发
})

export type PlayerSchemaType = Static<typeof PlayerSchema>
