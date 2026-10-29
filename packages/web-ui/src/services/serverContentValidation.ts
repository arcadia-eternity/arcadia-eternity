import { Value } from '@sinclair/typebox/value'
import { SpeciesSchema, SkillSchema, MarkSchema } from '@arcadia-eternity/schema'
import type { ServerEnvironmentContent, ServerEnvironmentDescriptor } from '@arcadia-eternity/protocol'

export const CONTENT_NAMESPACES = ['species', 'skill', 'mark', 'mark_ability', 'mark_emblem', 'mark_global'] as const
const HASH = /^[a-f0-9]{64}$/
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256
function invalid(): never {
  throw new Error('服务器环境内容格式不正确或超过限制')
}

/** Bound all untrusted JSON, including ignored properties, before schema traversal or formatting. */
export function validateMetadataTree(value: unknown): void {
  let nodes = 0
  const visit = (item: unknown, depth: number) => {
    if (++nodes > 500_000 || depth > 16) invalid()
    if (typeof item === 'string') {
      if (item.length > 16_384) invalid()
      return
    }
    if (item === null || typeof item === 'boolean') return
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) invalid()
      return
    }
    if (Array.isArray(item)) {
      if (item.length > 20_000) invalid()
      for (const value of item) visit(value, depth + 1)
      return
    }
    if (!item || typeof item !== 'object') invalid()
    const entries = Object.entries(item)
    if (entries.length > 20_000) invalid()
    for (const [key, value] of entries) {
      if (key.length > 256 || ['__proto__', 'prototype', 'constructor'].includes(key)) invalid()
      visit(value, depth + 1)
    }
  }
  visit(value, 0)
}

export function validateEnvironmentDescriptor(value: unknown): asserts value is ServerEnvironmentDescriptor {
  validateMetadataTree(value)
  const descriptor = value as ServerEnvironmentDescriptor
  if (descriptor?.protocolVersion !== 1 || descriptor?.runtime?.kind !== 'native-v4')
    throw new Error('服务器环境协议不兼容')
  if (!HASH.test(descriptor.id) || !HASH.test(descriptor.resourceRevision)) invalid()
  if (
    descriptor.runtime?.kind !== 'native-v4' ||
    !identifier(descriptor.runtime.contentRevision) ||
    !identifier(descriptor.runtime.coreBuildId) ||
    !identifier(descriptor.runtime.registryBuildId)
  )
    invalid()
  if (
    !Array.isArray(descriptor.packages) ||
    descriptor.packages.length > 256 ||
    !Array.isArray(descriptor.resources) ||
    descriptor.resources.length > 4096 ||
    (descriptor.remoteResources !== undefined &&
      (!Array.isArray(descriptor.remoteResources) || descriptor.remoteResources.length > 4096))
  )
    invalid()
  const projects = new Set<string>()
  const namespaces = new Set<string>()
  for (const pkg of descriptor.packages) {
    if (
      !pkg ||
      !identifier(pkg.projectId) ||
      !identifier(pkg.namespace) ||
      !identifier(pkg.name) ||
      !identifier(pkg.version) ||
      projects.has(pkg.projectId) ||
      namespaces.has(pkg.namespace)
    )
      invalid()
    projects.add(pkg.projectId)
    namespaces.add(pkg.namespace)
  }
  const resources = new Set<string>()
  for (const item of descriptor.resources) {
    if (
      !item ||
      !identifier(item.projectId) ||
      !identifier(item.id) ||
      !identifier(item.variant) ||
      !identifier(item.mime) ||
      !HASH.test(item.sha256) ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 1 ||
      item.bytes > 64 * 1024 * 1024
    )
      invalid()
    const key = `${item.projectId}/${item.id}/${item.variant}`
    if (resources.has(key)) invalid()
    resources.add(key)
    if (item.url !== `/api/v1/environments/${descriptor.id}/assets/${item.sha256}`)
      throw new Error('服务器展示资源地址无效')
  }
  const remote = new Set<string>()
  for (const item of descriptor.remoteResources ?? []) {
    if (!item || !identifier(item.projectId) || !identifier(item.id) || typeof item.url !== 'string') invalid()
    const key = `${item.projectId}/${item.id}`
    if (remote.has(key)) invalid()
    remote.add(key)
    const url = new URL(item.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
      throw new Error('服务器远程资源地址无效')
  }
}

export function validateEnvironmentContent(value: unknown): asserts value is ServerEnvironmentContent {
  validateMetadataTree(value)
  const content = value as ServerEnvironmentContent
  if (!content || Object.keys(content).some(key => !['species', 'skills', 'marks', 'locales'].includes(key))) invalid()
  const rows = [content.species, content.skills, content.marks]
  const schemas = [SpeciesSchema, SkillSchema, MarkSchema]
  const ids = rows.map((items, index) => {
    if (!Array.isArray(items) || items.length > 20_000) invalid()
    const seen = new Set<string>()
    for (const item of items) {
      const schema = schemas[index]
      if (item?.presentation?.battle && !['image', 'seer2-swf'].includes(item.presentation.battle.renderer))
        throw new Error('服务器展示能力不兼容')
      if (!item || !identifier(item.id) || seen.has(item.id) || !Value.Check(schema, item)) invalid()
      // Public skill/mark records carry display data only. Unknown fields cannot become an extension API.
      const allowed = new Set([
        ...Object.keys(schema.properties).filter(key => key !== 'effect' && (index !== 2 || key !== 'config')),
        'name',
        'description',
      ])
      if (Object.keys(item).some(key => !allowed.has(key))) invalid()
      if (
        ('name' in item && typeof item.name !== 'string') ||
        ('description' in item && typeof item.description !== 'string')
      )
        invalid()
      seen.add(item.id)
    }
    return seen
  })
  for (const species of content.species) {
    for (const skill of species.learnable_skills) if (!ids[1].has(skill.skill_id)) invalid()
    for (const mark of [...species.ability, ...species.emblem]) if (!ids[2].has(mark)) invalid()
  }
  if (content.locales) {
    const { defaultLocale, bundles } = content.locales
    if (
      !identifier(defaultLocale) ||
      !bundles ||
      typeof bundles !== 'object' ||
      Array.isArray(bundles) ||
      Object.keys(bundles).length > 32
    )
      invalid()
    for (const [language, namespaces] of Object.entries(bundles)) {
      if (!identifier(language) || !namespaces || typeof namespaces !== 'object' || Array.isArray(namespaces)) invalid()
      for (const [namespace, entries] of Object.entries(namespaces)) {
        if (
          !(CONTENT_NAMESPACES as readonly string[]).includes(namespace) ||
          !entries ||
          typeof entries !== 'object' ||
          Array.isArray(entries)
        )
          invalid()
        const known = ids[namespace === 'species' ? 0 : namespace === 'skill' ? 1 : 2]
        for (const [id, fields] of Object.entries(entries)) {
          if (!known.has(id) || !fields || typeof fields !== 'object' || Array.isArray(fields)) invalid()
          for (const [key, field] of Object.entries(fields))
            if (!['name', 'description'].includes(key) || typeof field !== 'string') invalid()
        }
      }
    }
  }
}
