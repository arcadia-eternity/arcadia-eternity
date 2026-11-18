import { z } from 'zod'

const id = z
  .string()
  .min(1)
  .max(256)
  .refine(value => !['__proto__', 'constructor', 'prototype'].includes(value))
const number = z.number().finite()
const range = { minimum: number.optional(), maximum: number.optional(), integer: z.boolean().optional() }
const groupSchema = z.object({ id, name: id, unit: id, ...range }).strict()
const groupValues = z.record(id, number)
const profileSchema = z.object({ id, name: id, groups: groupValues }).strict()
const address = { skill: id, useId: id, parameter: id }
const bindingSchema = z.object({ id: id.optional(), ...address, group: id }).strict()
const overrideSchema = z.object({ ...address, value: number }).strict()
const memberSchema = z.object({ ...address, base: number, group: id.optional(), ...range }).strict()
const rows = <T extends z.ZodType>(schema: T) => z.array(schema).max(50000)
export const skillParameterPolicySchema = z
  .object({
    profile: id.optional(),
    groups: groupValues.optional(),
    overrides: rows(overrideSchema).optional(),
  })
  .strict()
export const skillParameterCatalogSchema = z
  .object({
    groups: rows(groupSchema),
    profiles: rows(profileSchema),
    members: rows(memberSchema),
  })
  .strict()
export type SkillParameterPolicy = z.infer<typeof skillParameterPolicySchema>
export type SkillParameterCatalog = z.infer<typeof skillParameterCatalogSchema>
type Member = SkillParameterCatalog['members'][number]
type Address = Pick<Member, 'skill' | 'useId' | 'parameter'>
export const skillParameterKey = (entry: Address) => JSON.stringify([entry.skill, entry.useId, entry.parameter])

interface ParameterSource {
  parameterGroups?: readonly unknown[]
  parameterProfiles?: readonly unknown[]
  parameterBindings?: readonly unknown[]
  behaviors?: readonly unknown[]
  skills: readonly unknown[]
}
function unique<T>(entries: readonly T[], key: (entry: T) => string) {
  const map = new Map<string, T>()
  for (const entry of entries) {
    const name = key(entry)
    if (map.has(name)) throw new Error('重复的技能参数定义 ' + name)
    map.set(name, entry)
  }
  return map
}
function inRange(value: number, limits: Pick<Member, 'integer' | 'minimum' | 'maximum'>, name: string) {
  if (
    !Number.isFinite(value) ||
    (limits.integer && !Number.isInteger(value)) ||
    (limits.minimum !== undefined && value < limits.minimum) ||
    (limits.maximum !== undefined && value > limits.maximum)
  )
    throw new Error(name + ' 的参数值超出范围：' + value)
}

/** Build a display-safe parameter inventory using static declarations only. */
export function readSkillParameterCatalog(data: ParameterSource): SkillParameterCatalog {
  const groups = rows(groupSchema).parse(data.parameterGroups ?? [])
  const profiles = rows(profileSchema).parse(data.parameterProfiles ?? [])
  const bindings = unique(rows(bindingSchema).parse(data.parameterBindings ?? []), skillParameterKey)
  const definitions = new Map(
    (data.behaviors ?? []).map(raw => {
      const row = raw as {
        id: string
        parameters: Record<
          string,
          { kind: string; default: unknown; minimum?: number; maximum?: number; integer?: boolean }
        >
      }
      return [row.id, row]
    }),
  )
  const members: Member[] = []
  for (const raw of data.skills) {
    const skill = raw as {
      id: string
      behaviors?: { useId: string; definitionId: string; params?: Record<string, unknown> }[]
    }
    for (const use of skill.behaviors ?? []) {
      const definition = definitions.get(use.definitionId)
      if (!definition) continue // Reusable templates can also be supplied by the host at assembly.
      for (const [parameter, spec] of Object.entries(definition.parameters)) {
        if (spec.kind !== 'number') continue
        const target = { skill: skill.id, useId: use.useId, parameter }
        const key = skillParameterKey(target)
        const group = bindings.get(key)?.group
        const base = number.parse(use.params?.[parameter] ?? spec.default)
        members.push({
          ...target,
          base,
          ...(group && { group }),
          ...(spec.minimum !== undefined && { minimum: spec.minimum }),
          ...(spec.maximum !== undefined && { maximum: spec.maximum }),
          ...(spec.integer && { integer: true }),
        })
        bindings.delete(key)
      }
    }
  }
  if (bindings.size) throw new Error('技能参数绑定缺少数值参数 ' + bindings.keys().next().value)
  const catalog = { groups, profiles, members }
  resolveSkillParameters(catalog)
  return catalog
}

export function resolveSkillParameters(catalog: SkillParameterCatalog, policy: SkillParameterPolicy = {}) {
  const groups = unique(catalog.groups, row => row.id)
  const profiles = unique(catalog.profiles, row => row.id)
  const members = unique(catalog.members, skillParameterKey)
  const overrides = unique(policy.overrides ?? [], skillParameterKey)
  for (const key of overrides.keys()) if (!members.has(key)) throw new Error('单招例外缺少目标 ' + key)
  const profile = policy.profile ? profiles.get(policy.profile) : undefined
  if (policy.profile && !profile) throw new Error('缺少技能数值方案 ' + policy.profile)
  for (const row of groups.values())
    if (row.minimum !== undefined && row.maximum !== undefined && row.maximum < row.minimum)
      throw new Error('参数组范围无效 ' + row.id)
  for (const values of [...catalog.profiles.map(row => row.groups), policy.groups ?? {}]) {
    for (const [id, value] of Object.entries(values)) {
      const group = groups.get(id)
      if (!group) throw new Error('缺少技能参数组 ' + id)
      inRange(value, group, id)
    }
  }
  return catalog.members.map(member => {
    const key = skillParameterKey(member)
    const group = member.group && groups.get(member.group)
    if (member.group && !group) throw new Error(key + ' 引用了未知参数组 ' + member.group)
    if (group) inRange(member.base, group, key)
    const groupValue = group ? policy.groups?.[group.id] : undefined
    const preset = group ? profile?.groups[group.id] : undefined
    const override = overrides.get(key)
    const value = override?.value ?? groupValue ?? preset ?? member.base
    inRange(value, member, key)
    if (group) inRange(value, group, key)
    return {
      ...member,
      value,
      source: override ? 'override' : groupValue !== undefined ? 'group' : preset !== undefined ? 'profile' : 'base',
    }
  })
}

/** Only changed uses receive a copy. The content shared by another room stays immutable. */
export async function prepareSkillParameters<T extends ParameterSource>(
  data: T,
  revision: string,
  policy?: SkillParameterPolicy,
) {
  if (!policy) return { data, revision }
  const values = resolveSkillParameters(readSkillParameterCatalog(data), policy)
  const changed = values.filter(row => row.base !== row.value)
  if (!changed.length) return { data, revision }
  const byUse = new Map<string, Record<string, number>>()
  for (const entry of changed) {
    const key = JSON.stringify([entry.skill, entry.useId])
    const params = byUse.get(key) ?? Object.create(null)
    params[entry.parameter] = entry.value
    byUse.set(key, params)
  }
  const skills = data.skills.map(raw => {
    const skill = raw as { id: string; behaviors?: { useId: string; params?: Record<string, unknown> }[] }
    if (!skill.behaviors?.some(use => byUse.has(JSON.stringify([skill.id, use.useId])))) return raw
    return {
      ...skill,
      behaviors: skill.behaviors.map(use => {
        const changes = byUse.get(JSON.stringify([skill.id, use.useId]))
        return changes ? { ...use, params: { ...use.params, ...changes } } : use
      }),
    }
  })
  const entries = changed
    .map(row => [skillParameterKey(row), row.value] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(entries)))
  const suffix = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
  return { data: { ...data, skills }, revision: revision + '/parameters:' + suffix }
}
