import { maxEquippedSkills, type SkillSlots } from '@arcadia-eternity/const'
import type { PetSchemaType } from '@arcadia-eternity/schema'

export interface TeamContentLookup {
  getEnhancement?: (id: string) => unknown
  getNature?: (id: string) => { generation: 1 | 2 } | undefined
  getSpecies: (id: string) => unknown
  getSkill: (id: string) => unknown
  getMark: (id: string) => unknown
}

export interface MissingTeamContent {
  petId: string
  petName: string
  kind: 'species' | 'skill' | 'inheritedSkill' | 'ability' | 'emblem' | 'nature' | 'enhancement'
  contentId: string
  skillIndex?: number
  namespace?: string
  message: string
}

const labels = {
  species: '精灵',
  skill: '技能',
  inheritedSkill: '遗传技能',
  ability: '特性',
  emblem: '纹章',
  nature: '性格',
  enhancement: '强化阶段',
}

/** Resolution is a view of a saved draft; it must never repair or remove its references. */
export function findMissingTeamContent(
  pets: readonly PetSchemaType[],
  content: TeamContentLookup,
): MissingTeamContent[] {
  const missing: MissingTeamContent[] = []
  const lookup = {
    species: content.getSpecies,
    skill: content.getSkill,
    inheritedSkill: content.getSkill,
    ability: content.getMark,
    emblem: content.getMark,
    nature: content.getNature,
    enhancement: content.getEnhancement,
  }
  for (const pet of pets) {
    const check = (kind: MissingTeamContent['kind'], id: string | undefined, skillIndex?: number) => {
      if (id === undefined || (!id && kind !== 'skill')) return
      const resolve = lookup[kind]
      if (!resolve || resolve(id)) return
      missing.push({
        petId: pet.id,
        petName: pet.name,
        kind,
        contentId: id,
        ...(skillIndex === undefined ? {} : { skillIndex }),
        ...(id.includes(':') ? { namespace: id.slice(0, id.indexOf(':')) } : {}),
        message: `${pet.name} 的${labels[kind]}「${id}」在当前对局内容中不可用。`,
      })
    }
    check('species', pet.species)
    pet.skills.forEach((id, index) => check('skill', id, index))
    check('ability', pet.ability)
    check('emblem', pet.emblem)
    check('inheritedSkill', pet.inheritedSkill)
    check('nature', pet.nature)
    check('enhancement', pet.enhancement)
  }
  return missing
}

export function categorySkillSlots(
  skills: readonly string[],
  policy: SkillSlots | undefined,
  climax: boolean,
  getSkill: (id: string) => { category: string } | undefined,
) {
  const equipped = skills.filter(id => {
    const skill = getSkill(id)
    return skill && (skill.category === 'Climax') === climax
  })
  if (!policy) return skills.length < maxEquippedSkills ? [...equipped, ''] : equipped
  const limit = climax ? policy.climaxMax : policy.normalMax
  // Keep slots that exceed a new format's limit visible until the player removes them.
  return [...equipped, ...Array<string>(Math.max(0, limit - equipped.length)).fill('')]
}

/** Edit one recognized category while preserving unresolved skills and the other category. */
export function replaceResolvedSkills(
  original: readonly string[],
  replacement: readonly string[],
  climax: boolean,
  getSkill: (id: string) => { category: string } | undefined,
): string[] {
  const pending = replacement.filter(Boolean)
  const result: string[] = []
  for (const id of original) {
    const skill = getSkill(id)
    if (skill && (skill.category === 'Climax') === climax) {
      const next = pending.shift()
      if (next) result.push(next)
    } else result.push(id)
  }
  result.push(...pending)
  if (result.length > maxEquippedSkills) throw new Error('未加载的技能仍占用槽位，请先明确移除或恢复缺失技能。')
  return result
}
