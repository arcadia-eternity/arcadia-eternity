/** The development service edits source; it is separate from player sessions and battle environments. */
export interface DevelopmentWorkspaceSnapshot {
  revision: string
  content: Record<string, unknown>
  project: {
    projectId: string
    namespace: string
  }
}

export type DevelopmentWorkspaceErrorCode =
  | 'ADDRESS_INVALID'
  | 'TOKEN_INVALID'
  | 'CLIENT_DISPOSED'
  | 'DEVELOPMENT_UNAVAILABLE'
  | 'DEVELOPMENT_UNAUTHORIZED'
  | 'REVISION_CONFLICT'
  | 'DEVELOPMENT_CHANGED'
  | 'DEVELOPMENT_BUSY'
  | 'DEVELOPMENT_CONTENT'
  | 'DEVELOPMENT_PACKAGE'
  | 'DEVELOPMENT_FILE'
  | 'DEVELOPMENT_PATH'
  | 'DEVELOPMENT_LIMIT'
  | 'RESPONSE_INVALID'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'

export class DevelopmentWorkspaceError extends Error {
  constructor(
    readonly code: DevelopmentWorkspaceErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DevelopmentWorkspaceError'
  }
}

/** Never send the administrator token to an arbitrary or redirected server. */
export function developmentServerOrigin(value: string): string {
  const input = value.trim()
  // Check the literal spelling before URL normalization, which accepts forms such as 127.1 or integer IPs.
  if (!/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?\/?$/i.test(input))
    throw new DevelopmentWorkspaceError('ADDRESS_INVALID', '开发工作区只允许连接本机服务地址')
  try {
    const url = new URL(input)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/')
      throw new Error('invalid address')
    return url.origin
  } catch {
    throw new DevelopmentWorkspaceError('ADDRESS_INVALID', '开发工作区只允许连接本机服务地址')
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function snapshot(value: unknown): DevelopmentWorkspaceSnapshot {
  if (
    !isObject(value) ||
    typeof value.revision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.revision) ||
    !isObject(value.content) ||
    !isObject(value.project) ||
    typeof value.project.projectId !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(value.project.projectId) ||
    typeof value.project.namespace !== 'string' ||
    !/^[a-z0-9][a-z0-9_.-]{0,79}$/.test(value.project.namespace)
  )
    throw new DevelopmentWorkspaceError('RESPONSE_INVALID', '开发服务返回的数据格式不正确')
  return {
    revision: value.revision,
    content: value.content,
    project: { projectId: value.project.projectId, namespace: value.project.namespace },
  }
}

const messages: Partial<Record<DevelopmentWorkspaceErrorCode, string>> = {
  DEVELOPMENT_UNAUTHORIZED: '开发令牌无效或没有访问权限',
  REVISION_CONFLICT: '源文件已被修改；本地编辑仍保留，请比较后重新加载',
  DEVELOPMENT_CHANGED: '源文件在保存期间发生变化；本地编辑仍保留',
  DEVELOPMENT_BUSY: '开发工作区正被其他操作使用，请稍后重试',
  DEVELOPMENT_CONTENT: '内容格式不正确，请检查后重试',
  DEVELOPMENT_PACKAGE: '内容包身份无效或已发生变化',
  DEVELOPMENT_FILE: '开发工作区文件不可用',
  DEVELOPMENT_PATH: '开发工作区路径不可用',
  DEVELOPMENT_LIMIT: '内容超过开发服务允许的大小',
}
function responseError(status: number, value: unknown): DevelopmentWorkspaceError {
  if (status === 404) return new DevelopmentWorkspaceError('DEVELOPMENT_UNAVAILABLE', '此服务器没有启用本机开发工作区')
  if (status === 401)
    return new DevelopmentWorkspaceError('DEVELOPMENT_UNAUTHORIZED', messages.DEVELOPMENT_UNAUTHORIZED!)
  const candidate = isObject(value) ? value.code : undefined
  if (typeof candidate === 'string' && Object.hasOwn(messages, candidate)) {
    const code = candidate as DevelopmentWorkspaceErrorCode
    return new DevelopmentWorkspaceError(code, messages[code]!)
  }
  if (status === 413) return new DevelopmentWorkspaceError('DEVELOPMENT_LIMIT', messages.DEVELOPMENT_LIMIT!)
  return new DevelopmentWorkspaceError('SERVER_ERROR', `开发服务请求失败（${status}）`)
}

/** One client represents one explicitly selected local authority and a token held only in memory. */
export class DevelopmentWorkspaceClient {
  readonly origin: string
  private token: string | undefined
  private readonly aborter = new AbortController()
  constructor(
    server: string,
    token: string,
    private readonly request: typeof fetch = fetch,
  ) {
    this.origin = developmentServerOrigin(server)
    if (typeof token !== 'string' || token.length < 32 || token.length > 256)
      throw new DevelopmentWorkspaceError('TOKEN_INVALID', '请输入 32 至 256 个字符的开发令牌')
    try {
      // Let Fetch's header implementation reject invalid bytes without exposing the token.
      const headers = new Headers({ Authorization: `Bearer ${token}` })
      if (headers.get('Authorization') !== `Bearer ${token}`) throw new Error('invalid token')
    } catch {
      throw new DevelopmentWorkspaceError('TOKEN_INVALID', '开发令牌包含 HTTP 不支持的字符')
    }
    this.token = token
  }

  dispose(): void {
    this.token = undefined
    this.aborter.abort()
  }

  read(signal?: AbortSignal): Promise<DevelopmentWorkspaceSnapshot> {
    return this.call('GET', undefined, signal)
  }

  async save(
    revision: string,
    content: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<DevelopmentWorkspaceSnapshot> {
    if (!/^[a-f0-9]{64}$/.test(revision) || !isObject(content))
      throw new DevelopmentWorkspaceError('DEVELOPMENT_CONTENT', '内容或文件修订无效')
    return this.call('PUT', { revision, content }, signal)
  }

  private async call(
    method: 'GET' | 'PUT',
    body: { revision: string; content: Record<string, unknown> } | undefined,
    signal?: AbortSignal,
  ): Promise<DevelopmentWorkspaceSnapshot> {
    if (!this.token) throw new DevelopmentWorkspaceError('CLIENT_DISPOSED', '开发工作区已关闭，请重新连接')
    let encoded: string | undefined
    try {
      encoded = body ? JSON.stringify(body) : undefined
    } catch {
      throw new DevelopmentWorkspaceError('DEVELOPMENT_CONTENT', '内容无法保存为 JSON，请检查后重试')
    }
    const controller = new AbortController()
    const signals = signal ? [this.aborter.signal, signal] : [this.aborter.signal]
    const abort = () => controller.abort()
    for (const source of signals) {
      if (source.aborted) abort()
      else source.addEventListener('abort', abort, { once: true })
    }
    try {
      let response: Response
      try {
        response = await this.request.call(globalThis, `${this.origin}/api/v1/development/content`, {
          method,
          headers: { Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: encoded } : {}),
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          mode: 'cors',
          signal: controller.signal,
        })
      } catch (error) {
        if (controller.signal.aborted) throw new DOMException('开发请求已取消', 'AbortError')
        throw new DevelopmentWorkspaceError('NETWORK_ERROR', '无法连接本机开发服务')
      }
      if (controller.signal.aborted) throw new DOMException('开发请求已取消', 'AbortError')
      if (!response.ok) {
        const details = await response.json().catch(() => undefined)
        if (controller.signal.aborted) throw new DOMException('开发请求已取消', 'AbortError')
        throw responseError(response.status, details)
      }
      try {
        const data: unknown = await response.json()
        if (controller.signal.aborted) throw new DOMException('开发请求已取消', 'AbortError')
        return snapshot(data)
      } catch (error) {
        if (error instanceof DevelopmentWorkspaceError || controller.signal.aborted) throw error
        throw new DevelopmentWorkspaceError('RESPONSE_INVALID', '开发服务返回的数据格式不正确')
      }
    } finally {
      for (const source of signals) source.removeEventListener('abort', abort)
    }
  }
}
