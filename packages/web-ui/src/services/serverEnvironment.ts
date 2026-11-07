import { METADATA_MAX_BYTES, publicHttpUrl, readResourceBytes } from './resourceTransport'
import {
  validateEnvironmentContent,
  validateEnvironmentDescriptor,
  validateMetadataTree,
} from './serverContentValidation'
import type { ResourceReference } from '@arcadia-eternity/schema'
import { mapPresentationResources } from '@arcadia-eternity/pack-loader/native'
import type {
  ServerEnvironmentAcceptance,
  ServerEnvironmentContent,
  ServerEnvironmentDescriptor,
} from '@arcadia-eternity/protocol'

/** The catalog belongs to the connected server, not to this browser's package workspace. */
export function environmentServerUrl(value: string): string {
  const url = new URL(value, globalThis.location?.href ?? 'http://localhost/')
  if (url.protocol === 'ws:') url.protocol = 'http:'
  if (url.protocol === 'wss:') url.protocol = 'https:'
  if (url.username || url.password || (url.protocol !== 'http:' && url.protocol !== 'https:'))
    throw new Error('不支持的服务器地址')
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export async function readEnvironmentJson<T>(
  url: string,
  request: typeof fetch,
  signal?: AbortSignal,
  bundledEnvironment = false,
): Promise<T> {
  const bytes = await readResourceBytes(url, { maxBytes: METADATA_MAX_BYTES, signal, bundledEnvironment }, request)
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  validateMetadataTree(value)
  return value as T
}

export async function listServerEnvironments(
  server: string,
  request: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ServerEnvironmentDescriptor[]> {
  const catalog = await readEnvironmentJson<{ protocolVersion: number; environments: ServerEnvironmentDescriptor[] }>(
    `${environmentServerUrl(server)}/api/v1/environments`,
    request,
    signal,
  )
  if (!catalog || catalog.protocolVersion !== 1 || !Array.isArray(catalog.environments))
    throw new Error('服务器环境协议不兼容')
  if (catalog.environments.length > 256) throw new Error('服务器环境数量超过限制')
  for (const item of catalog.environments) validateEnvironmentDescriptor(item)
  if (new Set(catalog.environments.map(item => item.id)).size !== catalog.environments.length)
    throw new Error('服务器环境标识重复')
  return catalog.environments
}

/** Read public metadata only; no development credential or executable code is sent. */
export async function readServerEnvironmentContent(
  server: string,
  id: string,
  request: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ServerEnvironmentContent> {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('服务器环境标识无效')
  const content = await readEnvironmentJson<ServerEnvironmentContent>(
    `${environmentServerUrl(server)}/api/v1/environments/${id}/content`,
    request,
    signal,
  )
  validateEnvironmentContent(content)
  return content
}

/** Resolve the server-approved display catalog. Media is loaded by its mounted consumer, without prefetch or caching. */
export async function prepareServerEnvironment(
  server: string,
  descriptor: ServerEnvironmentDescriptor,
  request: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<{
  content: ServerEnvironmentContent
  acceptance: ServerEnvironmentAcceptance
  readiness: { catalog: 'ready'; compatibility: 'compatible'; media: 'on-demand' }
}> {
  const base = environmentServerUrl(server)
  validateEnvironmentDescriptor(descriptor)
  const content = await readServerEnvironmentContent(server, descriptor.id, request, signal)
  const projects = new Map(descriptor.packages.map(pkg => [pkg.namespace, pkg.projectId]))
  const resourceKey = (project: string, id: string) => JSON.stringify([project, id])
  const remoteResources = new Map(
    descriptor.remoteResources?.map(item => [resourceKey(item.projectId, item.id), item.url]),
  )
  const files = new Map<string, string>()
  for (const item of descriptor.resources) {
    const key = resourceKey(item.projectId, item.id)
    const variant = resourceKey(item.projectId, `${item.id}/${item.variant}`)
    if (!files.has(variant)) files.set(variant, item.url)
    if (item.variant === 'default' && !files.has(key)) files.set(key, item.url)
  }
  const resourceUrl = (owner: string, reference: ResourceReference | undefined): string | undefined => {
    if (!reference) return reference
    const namespace =
      typeof reference === 'object'
        ? reference.namespace
        : owner.includes(':')
          ? owner.slice(0, owner.indexOf(':'))
          : ''
    const resourceId = typeof reference === 'object' ? reference.id : reference
    if (!namespace && typeof reference === 'string' && /^https?:\/\//.test(reference))
      return publicHttpUrl(reference).toString()
    const projectId = projects.get(namespace || 'base')
    if (!projectId) {
      if (typeof reference !== 'string') throw new Error('内容资源命名空间无效')
      // Unnamespaced core content may declare a direct HTTP resource. Never resolve against local workspace assets.
      if (!/^https?:\/\//.test(reference)) throw new Error('内容资源未在服务器目录声明')
      return publicHttpUrl(reference).toString()
    }
    const key = resourceKey(projectId, resourceId)
    const remote = remoteResources.get(key)
    if (remote) return remote
    const resource = files.get(key)
    if (!resource) throw new Error(`内容资源未在服务器目录声明：${reference}`)
    return `${base}${resource}`
  }
  const presentation = (
    item:
      | ServerEnvironmentContent['species'][number]
      | ServerEnvironmentContent['skills'][number]
      | ServerEnvironmentContent['marks'][number],
  ) => item.presentation && mapPresentationResources(item.presentation, ref => resourceUrl(item.id, ref)!)
  const displayContent: ServerEnvironmentContent = {
    ...(content.locales ? { locales: content.locales } : {}),
    species: content.species.map(item => ({
      ...item,
      presentation: presentation(item),
    })),
    skills: content.skills.map(item => ({
      ...item,
      presentation: presentation(item),
    })),
    marks: content.marks.map(item => ({
      ...item,
      presentation: presentation(item),
    })),
  }
  return {
    content: displayContent,
    readiness: { catalog: 'ready', compatibility: 'compatible', media: 'on-demand' },
    acceptance: {
      environmentId: descriptor.id,
      protocolVersion: 1,
      resourceRevision: descriptor.resourceRevision,
      resourcesReady: true,
    },
  }
}
