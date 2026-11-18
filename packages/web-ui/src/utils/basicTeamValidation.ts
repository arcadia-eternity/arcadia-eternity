import { teamConstraintIssues } from '@arcadia-eternity/const'
import { legacyNatures } from '@arcadia-eternity/const'
import { PetSchema, parseWithErrors, type PetSchemaType } from '@arcadia-eternity/schema'
import {
  assertEnvironmentMember,
  assertLearningChoices,
  resolveEnvironmentMechanics,
} from '@arcadia-eternity/content-sdk/environment-rules'
import type { EnvironmentRules } from '@arcadia-eternity/protocol'
import { toRaw } from 'vue'
import { Value } from '@sinclair/typebox/value'
import { findMissingTeamContent, type TeamContentLookup } from './teamContent'

const legacy = new Map(legacyNatures().map(nature => [nature.id, nature]))

type Content = TeamContentLookup & { rules?: EnvironmentRules }
export interface TeamIssue {
  message: string
  objectId?: string
  section?: 'moves' | 'training'
  field?: string
}
export function memberIssues(input: unknown, content?: Content): TeamIssue[] {
  let pet: PetSchemaType
  try {
    pet = parseWithErrors(PetSchema, input)
  } catch {
    return [{ message: '精灵数据不完整或超出可保存范围。' }]
  }
  const rules = toRaw(content?.rules)
  const issues: TeamIssue[] = []
  function issue(message: string, section?: TeamIssue['section'], field?: string) {
    issues.push({ objectId: pet.id, message, section, ...(field && { field }) })
  }
  const max = resolveEnvironmentMechanics(rules).individualValues.max
  const names = { hp: '体力', atk: '攻击', def: '防御', spa: '特攻', spd: '特防', spe: '速度' }
  for (const stat of Object.keys(names) as (keyof typeof names)[]) {
    if (pet.ivs[stat] > max)
      issue(`${pet.name} 的${names[stat]}资质 ${pet.ivs[stat]} 超过当前环境上限 ${max}。`, 'training', 'ivs.' + stat)
  }
  for (const problem of teamConstraintIssues(rules?.constraints, [pet], 'pet')) issue(problem.message, 'moves')
  if (rules) {
    const stage = rules.mechanics?.enhancement
    if (
      pet.enhancement &&
      (!stage ||
        stage.mode === 'forbidden' ||
        (stage.species && !stage.species.includes(pet.species)) ||
        (stage.stages && !stage.stages.includes(pet.enhancement)))
    )
      issue(pet.name + ' 的强化阶段在本环境不可用。', 'training')
    try {
      assertEnvironmentMember(rules, pet)
    } catch {
      if (!issues.length) issue(pet.name + ' 的物种、招式或印记受到环境限制。', 'moves')
    }
  }
  if (content) {
    const missingContent = findMissingTeamContent([pet], content)
    for (const missing of missingContent) {
      const training = missing.kind === 'enhancement' || missing.kind === 'nature'
      issue(
        missing.message,
        training ? 'training' : 'moves',
        missing.kind === 'skill' ? 'skills.' + missing.skillIndex : missing.kind,
      )
    }
    if (missingContent.length) return issues
    try {
      assertLearningChoices(
        rules,
        [pet],
        id => content.getSpecies(id),
        content.getNature ?? (id => legacy.get(id)),
        id => content.getEnhancement?.(id),
        content.getSkill,
      )
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      issue(pet.name + '：' + message, /性格|强化/.test(message) ? 'training' : 'moves')
    }
  }
  return issues
}

export function teamIssues(team: unknown, content?: Content): TeamIssue[] {
  const { minSize = 1, maxSize = 6, uniqueSpecies } = content?.rules?.team ?? {}
  if (!Array.isArray(team)) return [{ message: '队伍数据格式错误。' }]
  const issues: TeamIssue[] = []
  if (team.length < minSize || team.length > maxSize)
    issues.push({ message: `当前环境要求队伍包含 ${minSize}–${maxSize} 只精灵。` })
  const ids = new Set<string>()
  const species = new Set<string>()
  for (const pet of team) {
    issues.push(...memberIssues(pet, content))
    if (!Value.Check(PetSchema, pet)) continue
    if (ids.has(pet.id)) issues.push({ objectId: pet.id, message: pet.name + ' 的精灵编号重复，请重新添加该精灵。' })
    if (uniqueSpecies && species.has(pet.species))
      issues.push({ objectId: pet.id, message: pet.name + ' 的物种与队内其他精灵重复。' })
    ids.add(pet.id)
    species.add(pet.species)
  }
  const members = team.filter(pet => Value.Check(PetSchema, pet))
  for (const problem of teamConstraintIssues(content?.rules?.constraints, members, 'team'))
    for (const objectId of problem.members) issues.push({ objectId, message: problem.message, section: 'moves' })
  return issues
}

export function validateBasicTeam(team: unknown, content?: Content): string[] {
  return teamIssues(team, content).map(issue => issue.message)
}
