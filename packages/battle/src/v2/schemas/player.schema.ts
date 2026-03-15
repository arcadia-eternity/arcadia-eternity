// battle/src/schemas/player.schema.ts
// TypeBox schema for Player entity

import { Type, type Static } from '@sinclair/typebox'

export const PlayerSchema = Type.Object({
  type: Type.Literal('player'),
  id: Type.String(),
  name: Type.String(),
  activePetId: Type.String(),
  petIds: Type.Array(Type.String()),
  fullTeamPetIds: Type.Array(Type.String()),
  battleTeamPetIds: Type.Array(Type.String()),
  currentRage: Type.Number({ default: 20 }),
  maxRage: Type.Number({ default: 100 }),
}, { $id: 'Player' })

export type PlayerData = Static<typeof PlayerSchema>
