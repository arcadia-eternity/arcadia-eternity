import { PetSchema } from '@/schema/pet'
import { z } from 'zod'

export const PlayerSchema = z.object({
  name: z.string().min(1),
  team: z.array(PetSchema).min(1).max(6), //约定：位于第一位的为首发
})
