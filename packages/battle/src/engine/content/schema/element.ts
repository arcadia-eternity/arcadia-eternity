import { z } from 'zod'

export const ElementSchema = z.string().min(1).max(256)
