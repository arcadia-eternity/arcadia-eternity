// battle/src/v2/data/parsers/effect-parser.ts
// Parse raw YAML effect data → engine EffectDef.

import type { EffectDef } from '@arcadia-eternity/engine'

/**
 * Convert a raw YAML effect object to an engine EffectDef.
 * - `trigger` (string | string[]) → `triggers` (string[])
 * - `apply` and `condition` are passed through as opaque DSL JSON.
 */
export function parseEffect(raw: Record<string, unknown>): EffectDef {
  const id = raw.id as string
  if (!id) throw new Error('Effect missing "id"')

  const rawTrigger = raw.trigger
  const triggers: string[] = Array.isArray(rawTrigger) ? rawTrigger : [rawTrigger as string]

  const priority = (raw.priority as number) ?? 0

  const apply = raw.apply
  if (apply === undefined) throw new Error(`Effect '${id}' missing "apply"`)

  return {
    id,
    triggers,
    priority,
    apply,
    condition: raw.condition,
    consumesStacks: raw.consumesStacks as number | undefined,
    tags: (raw.tags as string[]) ?? [],
  }
}
