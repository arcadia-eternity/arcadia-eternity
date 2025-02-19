import { PetSchema } from './pet'
import { nanoid } from 'nanoid'
import { z } from 'zod'

export const PlayerSchema = z.object({
  name: z.string().min(1),
  id: z.string().nanoid().default(nanoid()),
  team: z.array(PetSchema).min(1).max(6), //约定：位于第一位的为首发
})

export type Player = z.infer<typeof PlayerSchema>
