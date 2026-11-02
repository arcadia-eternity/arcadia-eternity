import { WorkspaceError } from './workspace.mjs'
import { z } from 'zod'
const idPattern = /^[a-z0-9][a-z0-9_-]{0,79}$/
const packagePattern = /^(?:@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*$/
const fail = message => {
  throw new WorkspaceError('ENVIRONMENT_INVALID', message)
}
export const EnvironmentDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z
      .string()
      .regex(idPattern)
      .refine(value => value !== 'default', 'default 是内置环境'),
    name: z
      .string()
      .min(1)
      .max(80)
      .refine(value => !!value.trim())
      .transform(value => value.trim()),
    packages: z.record(
      z.string().regex(packagePattern),
      z
        .string()
        .min(1)
        .refine(
          value => !!value.trim() && !/(?:file:|link:|workspace:|\/|\\)/.test(value),
          '额外 npm 包需要可共享的注册表版本约束',
        ),
    ),
    sources: z
      .array(z.string().regex(packagePattern))
      .max(20)
      .refine(value => new Set(value).size === value.length, '源码包标识不能重复'),
  })
  .strict()
export function environmentDocument(value) {
  const parsed = EnvironmentDocumentSchema.safeParse(value)
  if (!parsed.success) fail(`环境配置无效：${parsed.error.issues[0].message}`)
  return parsed.data
}
export class DebugEnvironments {
  constructor(workspace) {
    this.workspace = workspace
  }
  file(id) {
    if (typeof id !== 'string' || !idPattern.test(id) || id === 'default') fail('环境标识无效')
    return `debug/environments/${id}.json`
  }
  async list() {
    const environments = [
      { schemaVersion: 1, id: 'default', name: '当前包与正式依赖', packages: {}, sources: [], version: null },
    ]
    for (const { file } of await this.workspace.files()) {
      if (!/^debug\/environments\/[^/]+\.json$/.test(file) || file.endsWith('.package-lock.json')) continue
      const source = await this.workspace.read(file),
        value = environmentDocument(JSON.parse(source.text))
      if (this.file(value.id) !== file) fail('环境文件名与标识不一致')
      environments.push({ ...value, version: source.version })
    }
    return environments
  }
  async save({ document, expectedVersion }) {
    const value = environmentDocument(document)
    const result = await this.workspace.write({
      file: this.file(value.id),
      expectedVersion,
      text: JSON.stringify(value, null, 2) + '\n',
    })
    return { ...value, version: result.version }
  }
}
