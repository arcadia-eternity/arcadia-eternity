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
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('不支持的服务器地址')
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

async function json<T>(url: string, request: typeof fetch): Promise<T> {
  const response = await request(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`服务器环境请求失败（${response.status}）`)
  return response.json() as Promise<T>
}

export async function listServerEnvironments(
  server: string,
  request: typeof fetch = fetch,
): Promise<ServerEnvironmentDescriptor[]> {
  const catalog = await json<{ protocolVersion: number; environments: ServerEnvironmentDescriptor[] }>(
    `${environmentServerUrl(server)}/api/v1/environments`,
    request,
  )
  if (catalog.protocolVersion !== 1 || !Array.isArray(catalog.environments)) throw new Error('服务器环境协议不兼容')
  return catalog.environments
}

/** Validate displayed bytes before acknowledging resource readiness. No effect code is fetched or executed. */
export async function prepareServerEnvironment(
  server: string,
  descriptor: ServerEnvironmentDescriptor,
  request: typeof fetch = fetch,
  subtle: SubtleCrypto | null | undefined = globalThis.crypto?.subtle,
): Promise<{ content: ServerEnvironmentContent; acceptance: ServerEnvironmentAcceptance }> {
  const base = environmentServerUrl(server)
  if (!/^[a-f0-9]{64}$/.test(descriptor.id) || descriptor.protocolVersion !== 1 || !Array.isArray(descriptor.resources))
    throw new Error('服务器环境协议不兼容')
  const content = await json<ServerEnvironmentContent>(`${base}/api/v1/environments/${descriptor.id}/content`, request)
  if (!Array.isArray(content.species) || !Array.isArray(content.skills) || !Array.isArray(content.marks))
    throw new Error('服务器环境内容格式不正确')
  if (descriptor.resources.length && !subtle) throw new Error('校验展示资源需要安全连接（HTTPS 或本机地址）')
  for (const resource of descriptor.resources) {
    if (
      !/^[a-f0-9]{64}$/.test(resource.sha256) ||
      !Number.isSafeInteger(resource.bytes) ||
      resource.bytes < 0 ||
      resource.bytes > 16 * 1024 * 1024
    )
      throw new Error('服务器展示资源描述无效')
    const expected = `/api/v1/environments/${descriptor.id}/assets/${resource.sha256}`
    if (resource.url !== expected) throw new Error('服务器展示资源地址无效')
    const response = await request(`${base}${expected}`)
    if (!response.ok) throw new Error(`展示资源未就绪（${response.status}）`)
    const bytes = await response.arrayBuffer()
    const digest = Array.from(new Uint8Array(await subtle!.digest('SHA-256', bytes)), byte =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
    if (bytes.byteLength !== resource.bytes || digest !== resource.sha256) throw new Error('展示资源校验失败')
  }
  const resourceUrl = (owner: string, reference: string | undefined): string | undefined => {
    if (!reference) return reference
    const namespace = owner.includes(':') ? owner.slice(0, owner.indexOf(':')) : ''
    const projectId = descriptor.packages.find(pkg => pkg.namespace === namespace)?.projectId
    if (!projectId) return reference
    const resource = descriptor.resources.find(
      item =>
        item.projectId === projectId &&
        (reference === `${item.id}/${item.variant}` || (reference === item.id && item.variant === 'default')),
    )
    if (!resource) throw new Error(`内容资源未在服务器目录声明：${reference}`)
    return `${base}${resource.url}`
  }
  const displayContent: ServerEnvironmentContent = {
    species: content.species.map(item => ({ ...item, assetRef: resourceUrl(item.id, item.assetRef) })),
    skills: content.skills.map(item => ({ ...item, sfxRef: resourceUrl(item.id, item.sfxRef) })),
    marks: content.marks.map(item => ({ ...item, iconRef: resourceUrl(item.id, item.iconRef) })),
  }
  return {
    content: displayContent,
    acceptance: {
      environmentId: descriptor.id,
      protocolVersion: 1,
      resourceRevision: descriptor.resourceRevision,
      resourcesReady: true,
    },
  }
}
