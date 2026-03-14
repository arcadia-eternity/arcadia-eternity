// battle/src/v2/data/parsers/skill-parser.ts
// Parse raw YAML skill data → v2 BaseSkillData.

import {
  AttackTargetOpinion,
  IgnoreStageStrategy,
} from '@arcadia-eternity/const'
import type { BaseSkillData } from '../../schemas/skill.schema.js'

/**
 * Convert a raw YAML skill object to a v2 BaseSkillData.
 * - `effect` (string[]) → `effectIds`
 * - Fills defaults for optional fields.
 */
export function parseSkill(raw: Record<string, unknown>): BaseSkillData {
  const id = raw.id as string
  if (!id) throw new Error('Skill missing "id"')

  const effectIds = (raw.effect as string[]) ?? []
  const tags = (raw.tags as string[]) ?? []

  return {
    type: 'baseSkill',
    id,
    sfxRef: raw.sfxRef as string | undefined,
    category: raw.category as BaseSkillData['category'],
    element: raw.element as BaseSkillData['element'],
    power: (raw.power as number) ?? 0,
    accuracy: (raw.accuracy as number) ?? 100,
    rage: (raw.rage as number) ?? 0,
    priority: (raw.priority as number) ?? 0,
    target: (raw.target as BaseSkillData['target']) ?? AttackTargetOpinion.opponent,
    multihit: (raw.multihit as BaseSkillData['multihit']) ?? 1,
    sureHit: (raw.sureHit as boolean) ?? false,
    sureCrit: (raw.sureCrit as boolean) ?? false,
    ignoreShield: (raw.ignoreShield as boolean) ?? false,
    ignoreOpponentStageStrategy: (raw.ignoreOpponentStageStrategy as BaseSkillData['ignoreOpponentStageStrategy']) ?? IgnoreStageStrategy.none,
    tags,
    effectIds,
  }
}
