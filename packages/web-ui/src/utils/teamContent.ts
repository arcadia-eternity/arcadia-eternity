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
  checkEnhancements = true,
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
    if (checkEnhancements) check('enhancement', pet.enhancement)
  }
  return missing
}

interface EditorSkillSlot {
  id: string
  position: number
  category: 'normal' | 'climax' | 'missing'
  index: number
  overflow?: boolean
  required?: boolean
}

/** Keep equipped moves in their saved order whenever a definition (and therefore its category) is unavailable. */
export function teamSkillGroups(
  skills: readonly string[],
  policy: SkillSlots | undefined,
  getSkill: (id: string) => { category: string } | undefined,
) {
  const counts = { normal: 0, climax: 0 }
  const limits = { normal: policy?.normalMax ?? maxEquippedSkills, climax: policy?.climaxMax ?? maxEquippedSkills }
  const equipped = skills.map((id, position): EditorSkillSlot => {
    const definition = getSkill(id)
    if (!definition) return { id, position, category: 'missing', index: position }
    const category = definition.category === 'Climax' ? 'climax' : 'normal'
    const index = counts[category]++
    return {
      id,
      position,
      index,
      category,
      overflow: index >= limits[category],
      required: category === 'climax' && index < (policy?.climaxMin ?? 0),
    }
  })
  const missing = equipped.some(slot => slot.category === 'missing')
  const groups = missing ? [{ name: '已装备技能', savedOrder: true, slots: equipped }] : []
  for (const category of ['normal', 'climax'] as const) {
    const slots = missing ? [] : equipped.filter(slot => slot.category === category)
    const empty = policy ? limits[category] - counts[category] : Number(skills.length < maxEquippedSkills)
    for (let i = 0; i < empty; i++) {
      const index = counts[category] + i
      slots.push({
        id: '',
        position: skills.length,
        category,
        index,
        required: category === 'climax' && index < (policy?.climaxMin ?? 0),
      })
    }
    if (slots.length) groups.push({ name: category === 'climax' ? '必杀技能' : '普通技能', savedOrder: false, slots })
  }
  return groups
}
