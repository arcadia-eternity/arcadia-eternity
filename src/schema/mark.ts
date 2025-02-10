import { z } from 'zod'
import { StackStrategy } from '@/core/mark'

export const StackStrategySchema = z.nativeEnum(StackStrategy)

export const MarkSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string(),
  config: z.object({
    duration: z.number().optional(),
    persistent: z.boolean().optional().default(true),
    maxStacks: z.number().int().optional(),
    stackable: z.boolean().optional().default(false),
    stackStrategy: StackStrategySchema.default(StackStrategy.extend),
    destoyable: z.boolean().default(true),
  }),
  tags: z.array(z.string()),
})

export type Mark = z.infer<typeof MarkSchema>

export function validateMark(data: unknown): Mark {
  return MarkSchema.parse(data)
}
