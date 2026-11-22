import { IndependentEnvironmentRulesSchema, EnvironmentRequirementsSchema } from '@arcadia-eternity/const'
export {
  EnvironmentRuleDeclarationSchema,
  EnvironmentRulesSchema,
  type EnvironmentRules,
} from '@arcadia-eternity/const'
import { WorkspaceError, type AuthorWorkspace } from './workspace.ts'
import { officialBasePackage, resolveOfficialWorkspaceManifest } from './official-environment-packages.ts'
import { isRecord } from './types.ts'
import { z } from 'zod'
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

const EnvironmentDocumentV1Schema = z.object({ schemaVersion: z.literal(1), ...sharedFields }).strict()
export const EnvironmentDocumentV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    ...sharedFields,
    rules: IndependentEnvironmentRulesSchema,
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

export function environmentManifestDocument(manifest: unknown): EnvironmentDocumentV2 {
  if (!isRecord(manifest) || !isRecord(manifest.arcadiaEnvironment) || !isRecord(manifest.dependencies))
    throw new WorkspaceError(
      'ENVIRONMENT_MANIFEST_INVALID',
      '环境包需要 arcadiaEnvironment 声明和 dependencies',
      'package.json',
    )
  const { sources } = manifest.arcadiaEnvironment
  if (!Array.isArray(sources))
    throw new WorkspaceError('ENVIRONMENT_MANIFEST_INVALID', '环境来源必须是一个数组', 'package.json')
  return normalizeEnvironmentDocument({
    ...manifest.arcadiaEnvironment,
    packages: Object.fromEntries(Object.entries(manifest.dependencies).filter(([name]) => !sources.includes(name))),
  })
}

export function environmentProjectDocument(manifest: unknown) {
  return environmentManifestDocument(resolveOfficialWorkspaceManifest(manifest))
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
    if (this.workspace.projectKind === 'environment') {
      const source = await this.workspace.read('package.json')
      return [{ ...environmentProjectDocument(JSON.parse(source.text)), version: source.version }]
    }
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
    if (this.workspace.projectKind === 'environment') {
      const source = await this.workspace.read('package.json')
      const manifest = JSON.parse(source.text)
      if (source.version !== expectedVersion)
        throw new WorkspaceError('REVISION_CONFLICT', '环境包声明已改变，请重新读取', source.file)
      const previous = environmentProjectDocument(manifest)
      if (previous.id !== value.id) fail('环境标识与当前项目不一致')
      const { packages, ...declaration } = normalizeEnvironmentDocument(value)
      if (declaration.sources.some(name => Object.hasOwn(packages, name))) fail('同一包不能同时声明版本和本机来源')
      const dependencies = {
        ...packages,
        ...Object.fromEntries(
          declaration.sources
            .filter(name => Object.hasOwn(manifest.dependencies, name))
            .map(name => [name, manifest.dependencies[name]]),
        ),
      }
      if (
        manifest.dependencies[officialBasePackage] === 'workspace:*' &&
        dependencies[officialBasePackage] === previous.packages[officialBasePackage] &&
        Object.hasOwn(packages, officialBasePackage)
      )
        dependencies[officialBasePackage] = 'workspace:*'
      const result = await this.workspace.write({
        file: source.file,
        expectedVersion,
        text: JSON.stringify({ ...manifest, dependencies, arcadiaEnvironment: declaration }, null, 2) + '\n',
      })
      return { ...declaration, packages, version: result.version }
    }
    const result = await this.workspace.write({
      file: this.file(value.id),
      expectedVersion,
      text: JSON.stringify(value, null, 2) + '\n',
    })
    return { ...value, version: result.version } as ListedEnvironment
  }
}
