import { StatType } from './const'

export enum Nature {
  Hardy = 'Hardy',
  Lonely = 'Lonely',
  Brave = 'Brave',
  Adamant = 'Adamant',
  Naughty = 'Naughty',
  Bold = 'Bold',
  Docile = 'Docile',
  Relaxed = 'Relaxed',
  Impish = 'Impish',
  Lax = 'Lax',
  Timid = 'Timid',
  Hasty = 'Hasty',
  Serious = 'Serious',
  Jolly = 'Jolly',
  Naive = 'Naive',
  Modest = 'Modest',
  Mild = 'Mild',
  Quiet = 'Quiet',
  Bashful = 'Bashful',
  Rash = 'Rash',
  Calm = 'Calm',
  Gentle = 'Gentle',
  Sassy = 'Sassy',
  Careful = 'Careful',
  Quirky = 'Quirky',
}

export const NatureMap: Record<Nature, Record<StatType, number>> = {
  Hardy: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
  Lonely: { hp: 1, atk: 1.1, def: 0.9, spa: 1, spd: 1, spe: 1 },
  Brave: { hp: 1, atk: 1.1, def: 1, spa: 1, spd: 1, spe: 0.9 },
  Adamant: { hp: 1, atk: 1.1, def: 1, spa: 0.9, spd: 1, spe: 1 },
  Naughty: { hp: 1, atk: 1.1, def: 1, spa: 1, spd: 0.9, spe: 1 },
  Bold: { hp: 1, atk: 0.9, def: 1.1, spa: 1, spd: 1, spe: 1 },
  Docile: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
  Relaxed: { hp: 1, atk: 1, def: 1.1, spa: 1, spd: 1, spe: 0.9 },
  Impish: { hp: 1, atk: 1, def: 1.1, spa: 0.9, spd: 1, spe: 1 },
  Lax: { hp: 1, atk: 1, def: 1.1, spa: 1, spd: 0.9, spe: 1 },
  Timid: { hp: 1, atk: 0.9, def: 1, spa: 1, spd: 1, spe: 1.1 },
  Hasty: { hp: 1, atk: 1, def: 0.9, spa: 1, spd: 1, spe: 1.1 },
  Serious: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
  Jolly: { hp: 1, atk: 1, def: 1, spa: 0.9, spd: 1, spe: 1.1 },
  Naive: { hp: 1, atk: 1, def: 1, spa: 1, spd: 0.9, spe: 1.1 },
  Modest: { hp: 1, atk: 0.9, def: 1, spa: 1.1, spd: 1, spe: 1 },
  Mild: { hp: 1, atk: 1, def: 0.9, spa: 1.1, spd: 1, spe: 1 },
  Quiet: { hp: 1, atk: 1, def: 1, spa: 1.1, spd: 1, spe: 0.9 },
  Bashful: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
  Rash: { hp: 1, atk: 1, def: 1, spa: 1.1, spd: 0.9, spe: 1 },
  Calm: { hp: 1, atk: 0.9, def: 1, spa: 1, spd: 1.1, spe: 1 },
  Gentle: { hp: 1, atk: 1, def: 0.9, spa: 1, spd: 1.1, spe: 1 },
  Sassy: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1.1, spe: 0.9 },
  Careful: { hp: 1, atk: 1, def: 1, spa: 0.9, spd: 1.1, spe: 1 },
  Quirky: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
} as const

export interface NatureDefinition {
  id: string
  name?: string
  generation: 1 | 2
  multipliers: Record<StatType, number>
}

/** Compatibility catalog for content created before packages could supply natures. */
export function legacyNatures(): NatureDefinition[] {
  return Object.values(Nature).map(id => ({ id, name: id, generation: 1, multipliers: { ...NatureMap[id] } }))
}

export function readNatureCatalog(input?: readonly unknown[]): NatureDefinition[] {
  if (input === undefined) return legacyNatures()
  if (!Array.isArray(input) || input.length > 10000) throw new Error('INVALID_NATURE_CATALOG')
  const ids = new Set<string>()
  const stats = Object.values(StatType)
  return input.map(row => {
    const nature = row as Partial<NatureDefinition> | null
    if (
      !nature ||
      typeof nature.id !== 'string' ||
      !/^[\w.:/-]{1,256}$/.test(nature.id) ||
      ids.has(nature.id) ||
      (nature.name !== undefined && (typeof nature.name !== 'string' || !nature.name.trim())) ||
      ![1, 2].includes(nature.generation ?? 0) ||
      !nature.multipliers ||
      Object.keys(nature.multipliers).length !== stats.length ||
      stats.some(stat => !Number.isFinite(nature.multipliers?.[stat]) || nature.multipliers![stat] <= 0)
    )
      throw new Error('INVALID_NATURE_DEFINITION: ' + nature?.id)
    ids.add(nature.id)
    return {
      id: nature.id,
      ...(nature.name !== undefined && { name: nature.name }),
      generation: nature.generation!,
      multipliers: { ...nature.multipliers },
    }
  })
}
