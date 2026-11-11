import YAML from 'yaml'
import { PetSchema, parseWithErrors } from '@arcadia-eternity/schema'
import { WorkspaceError } from './workspace.mjs'
import { z } from 'zod'

const validId = /^[a-z0-9][a-z0-9_-]{0,79}$/
const petKeys = Object.keys(PetSchema.properties).filter(key => key !== 'id')
const invalid = message => {
  throw new WorkspaceError('TEAM_INVALID', message)
}

/** Team envelope and portable pet fields are shared with author reference discovery. */
export const teamEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(validId),
    name: z
      .string()
      .min(1)
      .max(80)
      .refine(value => !!value.trim())
      .overwrite(value => value.trim()),
    team: z.array(z.unknown()).max(6),
  })
  .strict()
export const portablePetSchema = {
  ...PetSchema,
  properties: Object.fromEntries(petKeys.map(key => [key, PetSchema.properties[key]])),
  required: PetSchema.required.filter(key => key !== 'id'),
  additionalProperties: false,
}
const portablePetInputSchema = z.record(z.string(), z.unknown()).transform((value, context) => {
  try {
    if (Object.keys(value).some(key => !petKeys.includes(key))) throw new Error('精灵配置包含运行时编号或未知字段')
    const parsed = parseWithErrors(PetSchema, { ...value, id: '0'.repeat(21) })
    return Object.fromEntries(petKeys.filter(key => parsed[key] !== undefined).map(key => [key, parsed[key]]))
  } catch (error) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: error.message })
    return z.NEVER
  }
})
export const TeamDocumentSchema = teamEnvelopeSchema.extend({ team: z.array(portablePetInputSchema).max(6) })

/** Portable team documents contain configurations, never battle or editor identities. */
export function teamDocument(value) {
  const parsed = TeamDocumentSchema.safeParse(value)
  if (!parsed.success) invalid(`测试队伍配置无效：${parsed.error.issues[0].message}`)
  return parsed.data
}

/** Copy saved team documents into independent players with deterministic, battle-local identities. */
export function playersFromTeams(teamLibrary, ids) {
  if (!Array.isArray(ids) || ids.length !== 2) throw new Error('测试必须显式指定两个项目队伍标识')
  return ids.map((id, side) => {
    const entry = teamLibrary.find(team => team.id === id)
    if (!entry) throw new Error(`TEAM_MISSING: ${id}`)
    return {
      id: String(side).repeat(21),
      name: entry.name,
      team: entry.team.map((pet, index) => ({ ...structuredClone(pet), id: `p${side}${index}`.padEnd(21, '0') })),
    }
  })
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
