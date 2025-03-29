import { z } from 'zod'

export const MarkImageSchema = z.record(z.string().url())

export type MarkImageSchemaType = z.infer<typeof MarkImageSchema>
