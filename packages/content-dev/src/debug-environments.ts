import {
  skillSlotsSchema,
  declaredConstraintsSchema,
  ruleCollectionsSchema,
  constraintEditsSchema,
  teamConstraintsSchema,
  skillParameterPolicySchema,
} from '@arcadia-eternity/const'
import { WorkspaceError, type AuthorWorkspace } from './workspace.ts'
import { z } from 'zod'
import { eligibilitySchema, enhancementSchema, inheritanceSchema, learnsetAdjustmentsSchema } from './learnsets.ts'
const idPattern = /^[a-z0-9][a-z0-9_-]{0,79}$/
const packagePattern = /^(?:@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*$/
function fail(message: string): never {
  throw new WorkspaceError('ENVIRONMENT_INVALID', message)
}
const sharedFields = {
  id: z
    .string()
    .regex(idPattern)
    .refine(value => value !== 'default', 'default 是内置环境'),
  name: z
    .string()
    .min(1)
    .max(80)
    .refine(value => !!value.trim())
    .overwrite(value => value.trim()),
  packages: z.record(
    z.string().regex(packagePattern),
    z
      .string()
      .min(1)
      .refine(
        value =>
          /^file:candidates\/[a-zA-Z0-9_.-]+\.tgz$/.test(value) ||
          (!!value.trim() && !/(?:file:|link:|workspace:|\/|\\)/.test(value)),
        '额外 npm 包需要可共享的注册表版本约束',
      ),
  ),
  sources: z
    .array(z.string().regex(packagePattern))
    .max(20)
    .refine(value => new Set(value).size === value.length, '源码包标识不能重复'),
}

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
          .optional(),
      })
      .strict()
      .optional(),
    learnsetAdjustments: learnsetAdjustmentsSchema.optional(),
    tier: z.string().regex(idPattern).optional(),
    allow: contentSelection.optional(),
    deny: contentSelection.optional(),
    team: z
      .object({
        minSize: z.number().int().min(1).max(100).optional(),
        maxSize: z.number().int().min(1).max(100).optional(),
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
  include: uniqueList(reference).optional(),
  constraintEdits: constraintEditsSchema.optional(),
}).refine(
  value =>
    (value.include === undefined && value.constraintEdits === undefined && value.collections === undefined) ||
    value.schemaVersion === 2,
  '规则集引用需要规则版本 2',
)

const EnvironmentRequirementsSchema = z
  .object({
    engine: z.string().trim().min(1).max(128).optional(),
    sdk: z.string().trim().min(1).max(128).optional(),
    capabilities: uniqueList(z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/)).optional(),
  })
  .strict()

const EnvironmentDocumentV1Schema = z.object({ schemaVersion: z.literal(1), ...sharedFields }).strict()
export const EnvironmentDocumentV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    ...sharedFields,
    rules: EnvironmentRuleDeclarationSchema,
    requires: EnvironmentRequirementsSchema,
  })
  .strict()

export const EnvironmentDocumentSchema = z.discriminatedUnion('schemaVersion', [
  EnvironmentDocumentV1Schema,
  EnvironmentDocumentV2Schema,
])
export type EnvironmentDocument = z.infer<typeof EnvironmentDocumentSchema>
export type EnvironmentDocumentV2 = z.infer<typeof EnvironmentDocumentV2Schema>
export type ListedEnvironment = EnvironmentDocument & { version: string | null }

export function environmentDocument(input: unknown): EnvironmentDocument {
  // Legacy removed declarations are not environment members. Keep old files readable;
  // the workspace archives the original manifest before its next write.
  if (input && typeof input === 'object' && !Array.isArray(input) && 'disabled' in input) {
    const { disabled: _removed, ...current } = input
    input = current
  }
  const parsed = EnvironmentDocumentSchema.safeParse(input)
  if (!parsed.success) fail(`环境配置无效：${parsed.error.issues[0]?.message ?? ''}`)
  return parsed.data
}

/** Read legacy documents into the shared domain model without rewriting source files. */
export function normalizeEnvironmentDocument(value: unknown): EnvironmentDocumentV2 {
  const document = environmentDocument(value)
  if (document.schemaVersion === 2) return document
  return { ...document, schemaVersion: 2, rules: { schemaVersion: 1 }, requires: {} }
}
export class DebugEnvironments {
  workspace: AuthorWorkspace
  constructor(workspace: AuthorWorkspace) {
    this.workspace = workspace
  }
  file(id: string): string {
    if (typeof id !== 'string' || !idPattern.test(id) || id === 'default') fail('环境标识无效')
    return `debug/environments/${id}.json`
  }
  async list(): Promise<ListedEnvironment[]> {
    const environments: ListedEnvironment[] = [
      { schemaVersion: 1, id: 'default', name: '当前包与正式依赖', packages: {}, sources: [], version: null },
    ]
    for (const { file } of await this.workspace.files()) {
      if (!/^debug\/environments\/[^/]+\.json$/.test(file) || file.endsWith('.package-lock.json')) continue
      const source = await this.workspace.read(file),
        value = environmentDocument(JSON.parse(source.text))
      if (this.file(value.id) !== file) fail('环境文件名与标识不一致')
      environments.push({ ...value, version: source.version } as ListedEnvironment)
    }
    return environments
  }
  async save({
    document,
    expectedVersion,
  }: {
    document: unknown
    expectedVersion: string | null
  }): Promise<ListedEnvironment> {
    const value = environmentDocument(document)
    const result = await this.workspace.write({
      file: this.file(value.id),
      expectedVersion,
      text: JSON.stringify(value, null, 2) + '\n',
    })
    return { ...value, version: result.version } as ListedEnvironment
  }
}
