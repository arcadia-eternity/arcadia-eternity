import { z } from 'zod'

export const MarkImageSchema = z.record(z.string(), z.url())

export type MarkImageSchemaType = z.infer<typeof MarkImageSchema>
