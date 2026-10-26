import { canonical, type Json } from '@arcadia-eternity/pack-loader/native'

/** Choosing another skill must not reset the learning rules of existing selections. */
export function selectLearnableSkills(existing: readonly Json[], references: readonly Json[]): Json[] {
  return references.flatMap(reference => {
    const matches = existing.filter(
      item =>
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        item.skill_id !== undefined &&
        canonical(item.skill_id) === canonical(reference),
    )
    return matches.length ? matches : [{ skill_id: reference, level: 1, hidden: false }]
  })
}
