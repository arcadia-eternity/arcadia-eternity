import { WorkspaceError } from './workspace.mjs'
const idPattern = /^[a-z0-9][a-z0-9_-]{0,79}$/
const packagePattern = /^(?:@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*$/
const fail = message => {
  throw new WorkspaceError('ENVIRONMENT_INVALID', message)
}
export function environmentDocument(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    !idPattern.test(value.id) ||
    value.id === 'default' ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 80
  )
    fail('环境需要独立标识及名称')
  if (
    !value.packages ||
    typeof value.packages !== 'object' ||
    Array.isArray(value.packages) ||
    !Array.isArray(value.sources) ||
    value.sources.length > 20
  )
    fail('环境需要 npm 包声明与本机源码包标识列表')
  if (Object.keys(value).some(key => !['schemaVersion', 'id', 'name', 'packages', 'sources'].includes(key)))
    fail('环境包含未知字段')
  for (const [name, spec] of Object.entries(value.packages)) {
    if (
      !packagePattern.test(name) ||
      typeof spec !== 'string' ||
      !spec.trim() ||
      /(?:file:|link:|workspace:|\/|\\)/.test(spec)
    )
      fail('额外 npm 包需要可共享的注册表版本约束；本机源码请使用源码包映射')
  }
  if (
    value.sources.some(name => typeof name !== 'string' || !packagePattern.test(name)) ||
    new Set(value.sources).size !== value.sources.length
  )
    fail('源码包标识无效或重复')
  return { schemaVersion: 1, id: value.id, name: value.name.trim(), packages: value.packages, sources: value.sources }
}
export class DebugEnvironments {
  constructor(workspace) {
    this.workspace = workspace
  }
  file(id) {
    if (!idPattern.test(id) || id === 'default') fail('环境标识无效')
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
