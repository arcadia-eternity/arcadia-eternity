import { z } from 'zod'

/** Serialized uses survive metadata-only editing; executable definitions remain host-owned. */
export const BehaviorUseSchema = z
  .object({
    useId: z.string().min(1).max(256),
    definitionId: z.string().min(1).max(256),
    params: z.record(z.union([z.number().finite(), z.string().max(4096), z.boolean()])).optional(),
  })
  .strict()
