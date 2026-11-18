import { z } from 'zod'

const id = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z0-9_./:-]+$/)
const selectorKind = z.enum(['species', 'skill', 'mark'])
const ids = z
  .array(id)
  .max(1000)
  .refine(values => new Set(values).size === values.length, '条件中有重复的内容 ID')
const condition = z.object({ kind: selectorKind, ids: ids.min(1) }).strict()
const declaredCondition = z
  .object({
    kind: selectorKind,
    ids,
    fromCollections: ids.min(1).optional(),
  })
  .strict()
  .refine(row => row.ids.length > 0 || !!row.fromCollections?.length, '请选择内容或引用集合')

function constraintSchemas<C extends z.ZodType>(selector: C) {
  const conditions = z.array(selector).min(1).max(32)
  const common = { id, allOf: conditions }
  const constraint = z.discriminatedUnion('kind', [
    z
      .object({
        ...common,
        kind: z.literal('ban'),
        scope: z.enum(['pet', 'team']),
        exceptWhen: conditions.optional(),
        exceptAny: z.array(conditions).min(1).max(32).optional(),
      })
      .strict(),
    z.object({ ...common, kind: z.literal('memberLimit'), max: z.number().int().nonnegative().max(100) }).strict(),
  ])
  const constraints = z
    .array(constraint)
    .max(256)
    .refine(rows => new Set(rows.map(row => row.id)).size === rows.length, '队伍规则 ID 重复')
  const edits = z
    .object({
      remove: ids.max(256).optional(),
      replace: constraints.optional(),
      clearExceptions: ids.max(256).optional(),
      exceptions: z
        .array(z.object({ target: id, allOf: conditions }).strict())
        .max(256)
        .optional(),
    })
    .strict()
  return { constraints, edits }
}
export const { constraints: teamConstraintsSchema } = constraintSchemas(condition)
export const { constraints: declaredConstraintsSchema, edits: constraintEditsSchema } =
  constraintSchemas(declaredCondition)
export const ruleCollectionsSchema = z
  .array(z.object({ id, kind: selectorKind, ids: ids.min(1) }).strict())
  .max(256)
  .refine(rows => new Set(rows.map(row => row.id)).size === rows.length, '集合 ID 重复')
export type RuleCollection = z.infer<typeof ruleCollectionsSchema>[number]
export type DeclaredTeamConstraint = z.infer<typeof declaredConstraintsSchema>[number]
export type TeamConstraint = z.infer<typeof teamConstraintsSchema>[number]
export type ConstraintEdits = z.infer<typeof constraintEditsSchema>

type Condition = z.infer<typeof condition>
type Member = { id?: string; species: string; skills: readonly string[]; ability?: string; emblem?: string }

function matches(member: Member, condition: Condition): boolean {
  switch (condition.kind) {
    case 'species':
      return condition.ids.includes(member.species)
    case 'skill':
      return member.skills.some(skill => condition.ids.includes(skill))
    case 'mark':
      return [member.ability, member.emblem].some(mark => mark !== undefined && condition.ids.includes(mark))
  }
}

/** Single-pet eligibility can be requested while the rest of a team is still empty. */
export function teamConstraintIssues(
  rules: readonly TeamConstraint[] | undefined,
  team: readonly Member[],
  scope: 'pet' | 'team',
) {
  const problems: { ruleId: string; members: (string | undefined)[]; message: string }[] = []
  for (const rule of rules ?? []) {
    const matched = (pet: Member) => rule.allOf.every(condition => matches(pet, condition))
    if (rule.kind === 'memberLimit') {
      if (scope !== 'team') continue
      const members = team.filter(matched)
      if (members.length > rule.max)
        problems.push({
          ruleId: rule.id,
          members: members.map(pet => pet.id),
          message: `${rule.id} 限制最多 ${rule.max} 只，当前有 ${members.length} 只符合条件`,
        })
    } else if (rule.scope === scope) {
      const hasAll = (conditions: Condition[]) =>
        conditions.every(condition => team.some(pet => matches(pet, condition)))
      const exemptions = [...(rule.exceptAny ?? []), ...(rule.exceptWhen ? [rule.exceptWhen] : [])]
      const members =
        scope === 'pet'
          ? team.filter(
              pet => matched(pet) && !exemptions.some(clause => clause.every(condition => matches(pet, condition))),
            )
          : hasAll(rule.allOf) && !exemptions.some(hasAll)
            ? team.filter(pet => rule.allOf.some(condition => matches(pet, condition)))
            : []
      if (members.length)
        problems.push({
          ruleId: rule.id,
          members: members.map(pet => pet.id),
          message: `${rule.id} 禁止${scope === 'pet' ? '同一只精灵' : '同一队伍'}同时满足此组合`,
        })
    }
  }
  return problems
}

export function validateConstraintReferences(
  rules: readonly TeamConstraint[] | undefined,
  known: Record<Condition['kind'], (id: string) => boolean>,
) {
  for (const rule of rules ?? []) {
    const conditions = [
      ...rule.allOf,
      ...(rule.kind === 'ban' ? [...(rule.exceptWhen ?? []), ...(rule.exceptAny ?? []).flat()] : []),
    ]
    for (const condition of conditions)
      for (const id of condition.ids)
        if (!known[condition.kind](id))
          throw new Error(`ENVIRONMENT_REFERENCE_MISSING: ${rule.id} / ${condition.kind} / ${id}`)
  }
}
