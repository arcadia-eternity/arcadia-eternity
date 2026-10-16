import { z } from 'zod'
import { StackStrategy } from '@arcadia-eternity/const'

export const StackStrategySchema = z.nativeEnum(StackStrategy)

export const MarkConfigSchema = z
  .object({
    duration: z.number().optional().default(-1),
    persistent: z.boolean().optional().default(true),
    maxStacks: z.number().int().optional().default(1),
    stackable: z.boolean().optional().default(false),
    stackStrategy: StackStrategySchema.optional().default(StackStrategy.extend),
    destroyable: z.boolean().optional().default(true),
    isShield: z.boolean().optional().default(false),
    keepOnSwitchOut: z.boolean().optional().default(false),
    transferOnSwitch: z.boolean().optional().default(false),
    inheritOnFaint: z.boolean().optional().default(false),
    mutexGroup: z.string().optional(),
  })
  .catchall(z.any())

export const MarkSchema = z.object({
  id: z.string().min(1),
  config: MarkConfigSchema.optional(),
  tags: z.array(z.string()).optional(),
  effect: z.array(z.string()).optional(),
})

export type MarkSchemaType = z.infer<typeof MarkSchema>

export function validateMark(data: unknown): MarkSchemaType {
  return MarkSchema.parse(data)
}

export const MarkDataSetSchema = z.array(MarkSchema)

export type MarkDataSet = z.infer<typeof MarkDataSetSchema>
