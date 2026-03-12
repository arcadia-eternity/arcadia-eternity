// battle/src/v2/data/parsers/mark-parser.ts
// Parse raw YAML mark data → v2 BaseMarkData.

import { Value } from '@sinclair/typebox/value'
import { MarkConfigSchema as SchemaMarkConfigSchema } from '@arcadia-eternity/schema'
import type { BaseMarkData, MarkConfigData } from '../../schemas/mark.schema.js'

/**
 * Convert a raw YAML mark object to a v2 BaseMarkData.
 * - `effect` (string[]) → `effectIds`
 * - `config` gets defaults filled via TypeBox Value.Default
 */
export function parseMark(raw: Record<string, unknown>): BaseMarkData {
  const id = raw.id as string
  if (!id) throw new Error('Mark missing "id"')

  // Fill config defaults using the schema package's MarkConfigSchema
  const rawConfig = (raw.config ?? {}) as Record<string, unknown>
  const configWithDefaults = Value.Default(SchemaMarkConfigSchema, structuredClone(rawConfig))
  const cleanedConfig = Value.Clean(SchemaMarkConfigSchema, configWithDefaults)
  const config = Value.Convert(SchemaMarkConfigSchema, cleanedConfig) as MarkConfigData

  const effectIds = (raw.effect as string[]) ?? []
  const tags = (raw.tags as string[]) ?? []

  return {
    type: 'baseMark',
    id,
    iconRef: raw.iconRef as string | undefined,
    config,
    tags,
    effectIds,
  }
}
