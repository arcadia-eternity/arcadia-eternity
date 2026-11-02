import YAML from 'yaml'
import { PetSchema, parseWithErrors } from '@arcadia-eternity/schema'
import { WorkspaceError } from './workspace.mjs'

const validId = /^[a-z0-9][a-z0-9_-]{0,79}$/
const petKeys = Object.keys(PetSchema.properties).filter(key => key !== 'id')
const invalid = message => {
  throw new WorkspaceError('TEAM_INVALID', message)
}

/** Portable team documents contain configurations, never battle or editor identities. */
export function teamDocument(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    !validId.test(value.id) ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 80 ||
    !Array.isArray(value.team) ||
    value.team.length > 6
  )
    invalid('测试队伍需要稳定标识、名称及最多六只精灵')
  if (Object.keys(value).some(key => !['schemaVersion', 'id', 'name', 'team'].includes(key)))
    invalid('测试队伍包含未知字段')
  const team = value.team.map(pet => {
    if (!pet || Object.keys(pet).some(key => !petKeys.includes(key))) invalid('精灵配置包含运行时编号或未知字段')
    const parsed = parseWithErrors(PetSchema, { ...pet, id: '0'.repeat(21) })
    return Object.fromEntries(petKeys.filter(key => parsed[key] !== undefined).map(key => [key, parsed[key]]))
  })
  return { schemaVersion: 1, id: value.id, name: value.name.trim(), team }
}
export class ProjectTeams {
  constructor(workspace) {
    this.workspace = workspace
  }
  file(id) {
    if (typeof id !== 'string' || !validId.test(id)) invalid('测试队伍标识无效')
    return `debug/teams/${id}.yaml`
  }
  async list() {
    const teams = []
    for (const { file } of await this.workspace.files()) {
      if (!/^debug\/teams\/[^/]+\.yaml$/.test(file)) continue
      const source = await this.workspace.read(file)
      const document = teamDocument(YAML.parse(source.text))
      if (file !== this.file(document.id)) invalid(`文件名与队伍标识不同：${file}`)
      teams.push({ ...document, version: source.version })
    }
    return teams
  }
  async save({ document, expectedVersion }) {
    const parsed = teamDocument(document)
    if (expectedVersion !== null && typeof expectedVersion !== 'string') invalid('保存需要已读取的文件版本')
    const saved = await this.workspace.write({
      file: this.file(parsed.id),
      expectedVersion,
      text: YAML.stringify(parsed),
    })
    return { ...parsed, version: saved.version }
  }
  async remove({ id, expectedVersion }) {
    if (typeof expectedVersion !== 'string') invalid('删除需要已读取的文件版本')
    await this.workspace.remove({ file: this.file(id), expectedVersion })
  }
}
