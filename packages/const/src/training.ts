import { StatType, type StatOutBattle } from './const'

/** Unmodified training stat. Nature is applied after the level step, preserving the engine's fractional values. */
export function trainingStat(
  stat: `${keyof StatOutBattle}`,
  base: number,
  level: number,
  iv: number,
  ev: number,
  natureMultiplier: number,
  stageBonus = 0,
): number {
  return trainingStatSteps(stat, base, level, iv, ev, natureMultiplier, stageBonus).total
}

export function trainingStatSteps(
  stat: `${keyof StatOutBattle}`,
  base: number,
  level: number,
  iv: number,
  ev: number,
  natureMultiplier: number,
  stageBonus = 0,
) {
  const effort = Math.floor(ev / 4)
  const scaled = Math.floor(((2 * base + iv + effort) * level) / 100)
  const levelBonus = stat === 'hp' ? level + 10 : 5
  const afterNature = (scaled + levelBonus) * natureMultiplier
  return { effort, scaled, levelBonus, natureMultiplier, afterNature, stageBonus, total: afterNature + stageBonus }
}

export interface EnhancementStage {
  id: string
  name?: string
  branch: string
  bonus: StatOutBattle
}

export function readEnhancementStages(input: readonly unknown[] = []): EnhancementStage[] {
  if (!Array.isArray(input) || input.length > 10000) throw new Error('INVALID_ENHANCEMENT_CATALOG')
  const ids = new Set<string>()
  return input.map(row => {
    const stage = row as Partial<EnhancementStage> | null
    if (
      !stage ||
      typeof stage.id !== 'string' ||
      !/^[\w.:/-]{1,256}$/.test(stage.id) ||
      ids.has(stage.id) ||
      (stage.name !== undefined && (typeof stage.name !== 'string' || !stage.name.trim())) ||
      typeof stage.branch !== 'string' ||
      !stage.branch.trim() ||
      !stage.bonus ||
      Object.keys(stage.bonus).length !== 6 ||
      Object.values(StatType).some(stat => !Number.isSafeInteger(stage.bonus?.[stat]) || stage.bonus![stat] < 0)
    )
      throw new Error('INVALID_ENHANCEMENT_STAGE: ' + stage?.id)
    ids.add(stage.id)
    return {
      id: stage.id,
      ...(stage.name !== undefined && { name: stage.name }),
      branch: stage.branch,
      bonus: { ...stage.bonus },
    }
  })
}
