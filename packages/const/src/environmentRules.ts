import { z } from 'zod'
import { skillSlotsSchema } from './skillSlots'
import {
  declaredConstraintsSchema,
  ruleCollectionsSchema,
  constraintEditsSchema,
  teamConstraintsSchema,
} from './teamConstraints'
import { skillParameterPolicySchema } from './skillParameters'

const id = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\p{Cc}]+$/u)
const ids = z
  .array(id)
  .max(10000)
  .refine(values => new Set(values).size === values.length, '重复的内容 ID')
export const eligibilitySchema = z.union([z.enum(['species', 'all', 'off']), ids])
export const enhancementSchema = z
  .object({
    mode: z.enum(['forbidden', 'suppressed', 'active']),
    stages: ids.optional(),
    species: ids.optional(),
  })
  .strict()
export const inheritanceSchema = z
  .object({
    eligible: eligibilitySchema,
    pool: z
      .object({ mode: z.enum(['fallback', 'append', 'replace']), skills: ids })
      .strict()
      .optional(),
  })
  .strict()
export const learnsetAdjustmentsSchema = z
  .array(
    z
      .object({
        species: id,
        source: z.enum(['normal', 'inherited']),
        skill: id,
        action: z.enum(['add', 'remove']),
        level: z.number().int().min(1).max(100).optional(),
      })
      .strict()
      .refine(
        row => row.level === undefined || (row.action === 'add' && row.source === 'normal'),
        '只有普通学习条目的新增操作能指定等级',
      ),
  )
  .max(10000)
  .refine(
    rows => new Set(rows.map(row => JSON.stringify([row.species, row.source, row.skill]))).size === rows.length,
    '同一物种、来源与技能只能调整一次',
  )

const reference = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z0-9_./:-]+$/)
const uniqueList = <T extends z.ZodType>(schema: T) =>
  z
    .array(schema)
    .max(10000)
    .refine(value => new Set(value).size === value.length, '引用不能重复')
const contentSelection = z
  .object({
    species: uniqueList(reference).optional(),
    skills: uniqueList(reference).optional(),
    marks: uniqueList(reference).optional(),
  })
  .strict()

/** Portable rule data. Runtime consumers must explicitly support every declared capability. */
export const EnvironmentRulesSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    constraints: teamConstraintsSchema.optional(),
    mechanics: z
      .object({
        skillSlots: skillSlotsSchema.optional(),
        individualValueDefault: z.number().int().min(0).max(120).optional(),
        individualValues: z
          .object({ max: z.number().int().min(0).max(120) })
          .strict()
          .optional(),
        allowFaintSwitch: z.boolean().optional(),
        inheritance: inheritanceSchema.optional(),
        enhancement: enhancementSchema.optional(),
        secondGenerationNatures: eligibilitySchema.optional(),
      })
      .strict()
      .optional(),
    skillParameters: skillParameterPolicySchema.optional(),
    matchups: z
      .object({
        table: reference.optional(),
        adjustments: z
          .array(z.object({ attack: reference, defense: reference, multiplier: z.number().nonnegative() }).strict())
          .max(50000)
          .refine(
            rows => new Set(rows.map(row => JSON.stringify([row.attack, row.defense]))).size === rows.length,
            '属性相克调整不能重复',
          )
          .optional(),
      })
      .strict()
      .optional(),
    learnsetAdjustments: learnsetAdjustmentsSchema.optional(),
    tier: z.literal('standard').optional(),
    allow: contentSelection.optional(),
    deny: contentSelection.optional(),
    team: z
      .object({
        minSize: z.number().int().min(1).max(6).optional(),
        maxSize: z.number().int().min(1).max(6).optional(),
        uniqueSpecies: z.boolean().optional(),
      })
      .strict()
      .refine(
        value => value.minSize === undefined || value.maxSize === undefined || value.minSize <= value.maxSize,
        '队伍最小数量不能大于最大数量',
      )
      .optional(),
  })
  .strict()
  .refine(
    rules =>
      rules.schemaVersion === 2 ||
      (rules.mechanics === undefined &&
        rules.learnsetAdjustments === undefined &&
        rules.constraints === undefined &&
        rules.matchups === undefined &&
        rules.skillParameters === undefined),
    '玩法机制需要规则版本 2',
  )
export type EnvironmentRules = z.infer<typeof EnvironmentRulesSchema>

export const EnvironmentRuleDeclarationSchema = EnvironmentRulesSchema.safeExtend({
  constraints: declaredConstraintsSchema.optional(),
  collections: ruleCollectionsSchema.optional(),
  include: uniqueList(reference).max(128).optional(),
  constraintEdits: constraintEditsSchema.optional(),
}).refine(
  value =>
    (value.include === undefined && value.constraintEdits === undefined && value.collections === undefined) ||
    value.schemaVersion === 2,
  '规则集引用需要规则版本 2',
)

export const EnvironmentRequirementsSchema = z
  .object({
    engine: z.string().trim().min(1).max(128).optional(),
    sdk: z.string().trim().min(1).max(128).optional(),
    capabilities: uniqueList(z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/)).optional(),
  })
  .strict()

export type EnvironmentRuleDeclaration = z.infer<typeof EnvironmentRuleDeclarationSchema>

export function parseRuleData<Schema extends z.ZodType>(schema: Schema, input: unknown): z.output<Schema> {
  const declaration = input === undefined ? { schemaVersion: 1 } : input
  const parsed = schema.safeParse(declaration)
  if (parsed.success) return parsed.data
  const unsupported = parsed.error.issues.some(issue => issue.path[0] === 'tier' || issue.path[0] === 'schemaVersion')
  const code = unsupported ? 'ENVIRONMENT_RULES_UNSUPPORTED' : 'ENVIRONMENT_RULES_INVALID'
  const detail = parsed.error.issues[0]?.path.join('.')
  throw Object.assign(new Error(detail ? code + ': ' + detail : code), { code })
}
