import { z } from 'zod'

const capacity = z.number().int().min(0).max(5)
export const skillSlotsSchema = z
  .object({
    normalMax: capacity,
    climaxMax: capacity,
    climaxMin: capacity.optional(),
  })
  .strict()
  .refine(
    value => value.normalMax + value.climaxMax <= 5 && (value.climaxMin ?? 0) <= value.climaxMax,
    '普通槽与必杀槽合计最多五个，必杀最低数量不能超过槽数',
  )
export type SkillSlots = z.infer<typeof skillSlotsSchema>
export const defaultEditorSkillSlots: Readonly<SkillSlots> = { normalMax: 4, climaxMax: 1 }

/** Older rules only constrained the total held by the pet format. */
export function assertSkillSlots(
  policy: SkillSlots | undefined,
  equipped: readonly string[],
  lookup: (id: string) => unknown,
) {
  if (!policy) return
  let climax = 0
  for (const id of equipped) {
    const skill = lookup(id)
    if (!skill || typeof skill !== 'object' || !('category' in skill)) throw new Error('缺少技能分类 ' + id)
    if (skill.category === 'Climax') climax++
  }
  if (equipped.length - climax > policy.normalMax) throw new Error('普通技能最多装备 ' + policy.normalMax + ' 个')
  if (climax > policy.climaxMax) throw new Error('必杀技能最多装备 ' + policy.climaxMax + ' 个')
  if (climax < (policy.climaxMin ?? 0)) throw new Error('必杀技能至少装备 ' + policy.climaxMin + ' 个')
}
