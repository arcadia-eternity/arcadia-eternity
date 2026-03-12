// battle/src/v2/data/parsers/species-parser.ts
// Parse raw YAML species data → v2 SpeciesData.

import type { SpeciesData } from '../../schemas/species.schema.js'

/**
 * Convert a raw YAML species object to a v2 SpeciesData.
 * - `ability` (string[]) → `abilityIds`
 * - `emblem` (string[]) → `emblemIds`
 * - Discards `learnable_skills` (not needed at battle runtime).
 */
export function parseSpecies(raw: Record<string, unknown>): SpeciesData {
  const id = raw.id as string
  if (!id) throw new Error('Species missing "id"')

  const baseStats = raw.baseStats as SpeciesData['baseStats']
  if (!baseStats) throw new Error(`Species '${id}' missing "baseStats"`)

  return {
    type: 'species',
    id,
    num: (raw.num as number) ?? 0,
    assetRef: raw.assetRef as string | undefined,
    element: raw.element as SpeciesData['element'],
    baseStats,
    genderRatio: (raw.genderRatio as SpeciesData['genderRatio']) ?? null,
    heightRange: (raw.heightRange as [number, number]) ?? [0, 0],
    weightRange: (raw.weightRange as [number, number]) ?? [0, 0],
    abilityIds: (raw.ability as string[]) ?? [],
    emblemIds: (raw.emblem as string[]) ?? [],
  }
}
