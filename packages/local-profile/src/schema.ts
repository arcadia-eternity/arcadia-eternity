import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { parseWithErrors, PetSetSchema, PetSchema } from '@arcadia-eternity/schema'
import { BattleMessageType, individualValueSpread } from '@arcadia-eternity/const'
import { MAX_STORED_TEAM_MEMBERS, migrateEmbeddedLibrary, newPersonalTeam } from './library'
import { nanoid } from 'nanoid'

export class ProfileError extends Error {
  constructor(
    readonly code: string,
    message = code,
    readonly path?: string,
  ) {
    super(message === 'PROFILE_BUSY' ? '个人资料暂时被占用，请稍后重试。' : message)
  }
}
export const MAX_BACKUP_BYTES = 24 * 1024 * 1024
const object = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false })
const text = Type.String({ minLength: 1, maxLength: 2048 })
// Reuse the pet contract, while rejecting unknown fields at every object level.
function strict(schema: TSchema): TSchema {
  const result = { ...schema }
  if (result.type === 'object') {
    result.additionalProperties = false
    result.properties = Object.fromEntries(Object.entries(result.properties).map(([k, v]) => [k, strict(v as TSchema)]))
  }
  if (result.items) result.items = strict(result.items)
  return result
}
const pet = strict(PetSchema) as typeof PetSchema
export const IdentitySchema = object({
  id: Type.String({ minLength: 1, maxLength: 128, pattern: '^(?!\\s)(?!.*\\s$)[^\\x00-\\x1f\\x7f-\\x9f]+$' }),
  name: Type.String({ minLength: 1, maxLength: 64, pattern: '^(?!\\s)(?!.*\\s$)[^\\x00-\\x1f\\x7f-\\x9f]+$' }),
})
export const SettingsSchema = object({
  battleRenderer: Type.Union([Type.Literal('swf'), Type.Literal('image')]),
  battleMotion: Type.Union([Type.Literal('standard'), Type.Literal('simple'), Type.Literal('reduced')]),
  mute: Type.Boolean(),
  musicMute: Type.Boolean(),
  soundMute: Type.Boolean(),
  musicVolume: Type.Number({ minimum: 0, maximum: 100 }),
  soundVolume: Type.Number({ minimum: 0, maximum: 100 }),
  background: text,
  battleMusic: text,
  visibleLogTypes: Type.Array(Type.Union(Object.values(BattleMessageType).map(v => Type.Literal(v))), {
    uniqueItems: true,
  }),
})
const LegacyDataSchema = object({
  profile: IdentitySchema,
  library: object({
    storage: Type.Array(pet, { maxItems: 10000 }),
    teams: Type.Array(object({ name: text, pets: Type.Array(pet, { maxItems: 6 }), ruleSetId: text }), {
      minItems: 1,
      maxItems: 1000,
    }),
    currentTeamIndex: Type.Integer({ minimum: 0 }),
  }),
  settings: SettingsSchema,
})
const originSchema = object({ name: Type.String({ minLength: 1, maxLength: 256 }), version: text })
const revision = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
const instanceId = PetSchema.properties.id
export const DataSchema = object({
  profile: IdentitySchema,
  library: object({
    version: Type.Literal(2),
    storage: Type.Array(object({ ...pet.properties, origin: Type.Optional(originSchema), revision }), {
      maxItems: 16000,
    }),
    teams: Type.Array(
      object({
        id: instanceId,
        name: text,
        ruleSetId: text,
        revision,
        environmentPreference: Type.Optional(
          object({ source: text, environmentId: text, environmentVersion: Type.Optional(text) }),
        ),
        memberIds: Type.Array(instanceId, { uniqueItems: true, maxItems: MAX_STORED_TEAM_MEMBERS }),
      }),
      { minItems: 1, maxItems: 1000 },
    ),
    currentTeamIndex: Type.Integer({ minimum: 0 }),
  }),
  settings: SettingsSchema,
})
export type ProfileData = Static<typeof DataSchema>
export const BackupSchema = object({
  format: Type.Literal('arcadia.profile'),
  version: Type.Literal(2),
  exportedAt: text,
  appVersion: text,
  data: DataSchema,
})
export type ProfileBackup = Static<typeof BackupSchema>

function bounds(value: unknown, depth = 0): void {
  if (depth > 32) throw new ProfileError('INVALID_BACKUP', '资料嵌套过深')
  if (typeof value === 'string' && value.length > 2048) throw new ProfileError('INVALID_BACKUP', '字段过长')
  if (value && typeof value === 'object') for (const v of Object.values(value)) bounds(v, depth + 1)
}
export function validateData(value: unknown): ProfileData {
  bounds(value)
  const error = Value.Errors(DataSchema, value).First()
  if (error) throw new ProfileError('INVALID_BACKUP', error.message, error.path)
  const data = value as ProfileData
  checkReferences(data.library)
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_BACKUP_BYTES)
    throw new ProfileError('BACKUP_TOO_LARGE')
  return structuredClone(data)
}
function checkReferences(library: ProfileData['library']) {
  if (library.currentTeamIndex >= library.teams.length)
    throw new ProfileError('INVALID_BACKUP', '队伍索引不存在', '/library/currentTeamIndex')
  const owned = new Set(library.storage.map(pet => pet.id))
  if (owned.size !== library.storage.length) throw new ProfileError('INVALID_BACKUP', '仓库精灵 ID 重复')
  if (new Set(library.teams.map(team => team.id)).size !== library.teams.length)
    throw new ProfileError('INVALID_BACKUP', '队伍 ID 重复')
  for (const team of library.teams)
    for (const id of team.memberIds)
      if (!owned.has(id)) throw new ProfileError('INVALID_BACKUP', `队伍 ${team.name} 引用了不存在的精灵 ${id}`)
}

export function validateLibrary(value: unknown): ProfileData['library'] {
  bounds(value)
  const error = Value.Errors(DataSchema.properties.library, value).First()
  if (error) throw new ProfileError('INVALID_BACKUP', error.message, error.path)
  const library = value as ProfileData['library']
  checkReferences(library)
  return structuredClone(library)
}

/** Read portable team selections without resolving or acquiring their source environment. */
export function readSharedTeam(input: unknown, defaultName: string) {
  const envelope = Array.isArray(input) ? { pets: input } : input
  if (!envelope || typeof envelope !== 'object' || !('pets' in envelope) || !Array.isArray(envelope.pets))
    throw new ProfileError('INVALID_TEAM', '队伍文件缺少成员列表')
  if ('version' in envelope && envelope.version !== 2) throw new ProfileError('INVALID_TEAM', '队伍文件版本不受支持')
  const name = 'name' in envelope ? envelope.name : defaultName
  if (!Value.Check(text, name) || envelope.pets.length > MAX_STORED_TEAM_MEMBERS)
    throw new ProfileError('INVALID_TEAM', '队伍名称或成员数量无效')
  const hints = envelope.pets.map((row: unknown) => {
    if (!row || typeof row !== 'object' || !('origin' in row)) return undefined
    if (!Value.Check(originSchema, row.origin)) throw new ProfileError('INVALID_TEAM', '精灵来源信息无效')
    return structuredClone(row.origin)
  })
  const pets = parseWithErrors(PetSetSchema, envelope.pets).map((item, index) =>
    hints[index] ? { ...item, origin: hints[index] } : item,
  )
  return { name, pets, ruleSetId: 'casual_standard_ruleset' }
}

export function migrateLegacyData(value: unknown): ProfileData {
  bounds(value)
  const error = Value.Errors(LegacyDataSchema, value).First()
  if (error) throw new ProfileError('INVALID_BACKUP', error.message, error.path)
  const data = value as Static<typeof LegacyDataSchema>
  for (const pets of [data.library.storage, ...data.library.teams.map(team => team.pets)]) {
    if (
      new Set(pets.map(pet => pet.id)).size !== pets.length ||
      pets.some(pet => Object.values(pet.ivs).some(iv => iv > 31))
    )
      throw new ProfileError('INVALID_BACKUP', '旧版精灵数据无效')
  }
  const library = migrateEmbeddedLibrary(data.library)
  for (const pet of library.storage) pet.ivMax = individualValueSpread(31)
  return validateData({ ...data, library })
}

export function parseBackup(input: string | Uint8Array): ProfileBackup {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  if (bytes.byteLength > MAX_BACKUP_BYTES) throw new ProfileError('BACKUP_TOO_LARGE')
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new ProfileError('INVALID_BACKUP', '无法解析资料文件')
  }
  if (value && typeof value === 'object' && 'version' in value && value.version === 1 && 'data' in value)
    value = { ...value, version: 2, data: migrateLegacyData(value.data) }
  if (value && typeof value === 'object' && 'version' in value && value.version !== 2)
    throw new ProfileError('UNSUPPORTED_VERSION')
  bounds(value)
  const error = Value.Errors(BackupSchema, value).First()
  if (error) throw new ProfileError('INVALID_BACKUP', error.message, error.path)
  const backup = value as ProfileBackup
  if (!Number.isFinite(Date.parse(backup.exportedAt))) throw new ProfileError('INVALID_BACKUP', '导出时间无效')
  return { ...backup, data: validateData(backup.data) }
}
export function defaultData(name?: string): ProfileData {
  const id = nanoid()
  return {
    profile: { id, name: name?.trim() || `游客-${id.slice(-4)}` },
    library: {
      storage: [],
      version: 2,
      teams: [newPersonalTeam('默认队伍', 'casual_standard_ruleset')],
      currentTeamIndex: 0,
    },
    settings: {
      battleRenderer: 'swf',
      battleMotion: 'standard',
      mute: false,
      musicMute: false,
      soundMute: false,
      musicVolume: 50,
      soundVolume: 50,
      background: 'random',
      battleMusic: 'random',
      visibleLogTypes: [
        BattleMessageType.SkillUse,
        BattleMessageType.Damage,
        BattleMessageType.Heal,
        BattleMessageType.SkillMiss,
        BattleMessageType.PetSwitch,
        BattleMessageType.BattleStart,
        BattleMessageType.BattleEnd,
        BattleMessageType.ForcedSwitch,
        BattleMessageType.FaintSwitch,
        BattleMessageType.PetDefeated,
        BattleMessageType.MarkApply,
        BattleMessageType.MarkDestroy,
      ],
    },
  }
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    )
  return JSON.stringify(value)
}
// A non-JSON sentinel carries undecodable file bytes through the narrow string IPC contract.
export const RAW_BINARY_PREFIX = '\0arcadia-profile-bytes:'
export function rawProfileBytes(raw: string): Uint8Array {
  return raw.startsWith(RAW_BINARY_PREFIX)
    ? Uint8Array.from(atob(raw.slice(RAW_BINARY_PREFIX.length)), char => char.charCodeAt(0))
    : new TextEncoder().encode(raw)
}
