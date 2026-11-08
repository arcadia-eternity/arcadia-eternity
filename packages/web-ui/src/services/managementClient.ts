/** Management context is captured per client, independently of the current play connection. */
export interface ManagementContext {
  readonly transport: 'http' | 'ipc'
  readonly endpoint: string
  readonly label: string
  readonly serverId?: string
  readonly workspaceId?: string
}

export type ManagementMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export interface ManagementRequestOptions {
  body?: unknown
  revision?: string | number
  idempotencyKey?: string
  signal?: AbortSignal
  /** One-call proof exchange for an already authenticated, explicitly granted player account. */
  accountProof?: string
}

export interface ManagementIpcRequest {
  method: ManagementMethod
  path: string
  body?: unknown
  headers?: Record<string, string>
}

export interface ManagementIpcResponse {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

export type ManagementIpcBridge = (request: ManagementIpcRequest) => Promise<ManagementIpcResponse>

export class ManagementError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 0,
    public readonly retryable = false,
    public readonly operationId?: string,
  ) {
    super(message)
    this.name = 'ManagementError'
  }
}

export interface ManagementClient {
  readonly context: Readonly<ManagementContext>
  request<T>(method: ManagementMethod, path: string, options?: ManagementRequestOptions): Promise<T>
  /** Held only in this context's memory. Never persisted in a shared store or put in a URL. */
  setCsrfToken(token?: string): void
}

const PREFIX = '/api/management/v1'
const MAX_COMMAND_BYTES = 2 * 1024 * 1024
const MAX_TRANSFER_BYTES = 128 * 1024 * 1024
const MAX_BACKUP_BYTES = 512 * 1024 * 1024
const MAX_IMPORT_ENVELOPE_BYTES = 130 * 1024 * 1024
const methods = new Set<ManagementMethod>(['GET', 'POST', 'PATCH', 'DELETE'])

function invalid(message: string): never {
  throw new ManagementError('INVALID_REQUEST', message)
}

function captureContext(context: ManagementContext, transport: ManagementContext['transport']) {
  if (context.transport !== transport) invalid('管理传输方式不匹配')
  const copy = { ...context }
  if (transport === 'http') {
    let url: URL
    try {
      url = new URL(copy.endpoint)
    } catch {
      return invalid('管理服务器地址无效')
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      invalid('管理服务器地址无效')
    copy.endpoint = url.toString().replace(/\/+$/, '')
  }
  return Object.freeze(copy)
}

function checkedPath(path: string): string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\#\u0000-\u0020]/.test(path))
    invalid('管理操作路径无效')
  const pathname = path.split('?')[0]!
  for (const part of pathname.split('/')) {
    let decoded: string
    try {
      decoded = decodeURIComponent(part)
    } catch {
      return invalid('管理操作路径无效')
    }
    if (decoded === '.' || decoded === '..' || /[\\/%\u0000-\u001f]/.test(decoded)) invalid('管理操作路径无效')
  }
  return path
}

function requestLimit(method: ManagementMethod, path: string): number {
  return method === 'POST' && /^\/workspaces\/[^/?]+\/import$/.test(path)
    ? MAX_IMPORT_ENVELOPE_BYTES
    : MAX_COMMAND_BYTES
}

function responseLimit(method: ManagementMethod, path: string): number {
  if (method === 'GET') {
    if (/^\/transfers\/[a-f0-9]{64}$/.test(path)) return MAX_TRANSFER_BYTES
    if (/^\/backups\/[a-f0-9]{64}$/.test(path)) return MAX_BACKUP_BYTES
  }
  return MAX_COMMAND_BYTES
}

function snapshotBody(body: unknown, limit: number): unknown {
  if (body === undefined) return undefined
  try {
    const encoded = JSON.stringify(body)
    if (new TextEncoder().encode(encoded).byteLength > limit)
      throw new ManagementError('REQUEST_TOO_LARGE', '管理操作内容超过此操作的大小限制')
    return JSON.parse(encoded)
  } catch (error) {
    if (error instanceof ManagementError) throw error
    return invalid('管理操作内容必须是可序列化的数据')
  }
}

function headersFor(method: ManagementMethod, options: ManagementRequestOptions, csrf?: string) {
  if (!methods.has(method)) invalid('管理操作方法无效')
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.revision !== undefined) {
    const revision = String(options.revision)
    if (!/^[\w.:-]{1,200}$/.test(revision)) invalid('资源版本无效')
    headers['If-Match'] = `"${revision}"`
  }
  if (options.idempotencyKey !== undefined) {
    if (!/^[\w.:-]{1,200}$/.test(options.idempotencyKey)) invalid('操作重试标识无效')
    headers['Idempotency-Key'] = options.idempotencyKey
  }
  if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf
  if (options.accountProof !== undefined) headers.Authorization = `Bearer ${options.accountProof}`
  return headers
}

function responseError(status: number, body: unknown): ManagementError {
  const envelope = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const detail =
    envelope.error && typeof envelope.error === 'object' ? (envelope.error as Record<string, unknown>) : envelope
  const code =
    typeof detail.code === 'string'
      ? detail.code
      : typeof envelope.error === 'string'
        ? envelope.error
        : `HTTP_${status}`
  const fallback: Record<number, string> = {
    401: '请先登录此服务器的管理账户',
    403: '没有执行此操作的权限',
    404: '目标资源不存在或当前服务器不支持此功能',
    409: '当前资源状态不允许此操作',
    412: '资源已被其他操作更新，请刷新后再试',
    422: '操作内容不符合要求',
  }
  const messages: Record<string, string> = {
    PASSKEY_INVALID: '通行密钥验证失败，请重试或使用其他登录方式。',
    PASSKEY_CHALLENGE_INVALID: '验证请求已过期或已使用，请重新发起登录。',
    PASSKEY_HTTPS_REQUIRED: '请通过 HTTPS 网页设置和使用通行密钥。',
    LOGIN_RATE_LIMITED: '尝试次数过多，请稍后重试。',
    INVALID_BOOTSTRAP_CODE: '登录码无效、已使用或已过期，请从宿主重新取得登录码。',
    MANAGEMENT_UNAUTHENTICATED: '管理会话已失效，请重新登录。',
    MANAGEMENT_FORBIDDEN: '此身份没有管理目标资源的权限。',
    CSRF_REJECTED: '管理会话校验失败，请重新登录后再试。',
    THIRD_PARTY_EXECUTION_FORBIDDEN: '此服务器未允许执行第三方内容，请选择受支持的托管方式。',
    DEFAULT_BINDING_REQUIRED: '请先为服务器选择其他默认环境。',
    BINDING_UNAVAILABLE: '此绑定尚未生效，请先发布可用版本。',
    ACCOUNT_NOT_ACTIVE: '此账户已停用或尚未建立。',
    PRINCIPAL_NOT_FOUND: '管理主体不存在，请先创建主体。',
    ENVIRONMENT_HAS_VERSIONS: '请先删除这个环境的固定版本，再删除环境草稿。',
    ENVIRONMENT_PACKAGE_REQUIRED: '其他资源包仍依赖它。请查看依赖关系，或明确选择连带停用。',
    DEFAULT_ENVIRONMENT_PACKAGE_REQUIRED: '默认环境必须保留基础内容包。',
    ENVIRONMENT_DEPENDENCIES_UNRESOLVED: '请先准备当前组合，确认依赖关系后再停用资源包。',
    ENVIRONMENT_DEPENDENCY_CONFLICT: '资源包的依赖范围不兼容，请调整组合后重试。已有固定版本保持不变。',
    CONTENT_VERSION_CONFLICT: '资源包版本发生冲突。请调整版本范围后重试，已有版本保持不变。',
    ENVIRONMENT_IN_USE: '服务器仍在使用此环境，请先移除绑定。',
    VERSION_IN_USE: '此版本仍有引用，请查看引用并先解除使用关系。',
    BATTLE_NOT_FOUND: '此对战已结束或不再活跃。',
    PEER_BATTLE_ADMIN_UNSUPPORTED: '玩家执行的对战无法由服务器直接终止。',
  }
  return new ManagementError(
    code,
    messages[code] ??
      (typeof detail.message === 'string' && detail.message !== code
        ? detail.message
        : (fallback[status] ?? `管理请求失败（${status}）`)),
    status,
    detail.retryable === true,
    typeof detail.operationId === 'string' ? detail.operationId : undefined,
  )
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('请求已取消', 'AbortError')
}

async function abortable<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task
  if (signal.aborted) {
    // Dispatch may synchronously abort its caller before returning the pending promise.
    void task.catch(() => {})
    throw abortReason(signal)
  }
  let onAbort: (() => void) | undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([task, cancelled])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

async function readJson(response: Response, maxBytes: number, signal?: AbortSignal): Promise<unknown> {
  if (response.status === 204) return undefined
  if (!response.body) throw new ManagementError('INVALID_RESPONSE', '管理服务器返回空响应', response.status)
  const advertisedLength = response.headers.get('content-length')
  if (advertisedLength !== null && /^\d+$/.test(advertisedLength) && Number(advertisedLength) > maxBytes) {
    void response.body.cancel().catch(() => {})
    throw new ManagementError('INVALID_RESPONSE', '管理响应超过大小限制')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal)
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new ManagementError('INVALID_RESPONSE', '管理响应超过大小限制')
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (error) {
    void reader.cancel().catch(() => {})
    if (signal?.aborted) throw abortReason(signal)
    if (error instanceof ManagementError) throw error
    throw new ManagementError('INVALID_RESPONSE', '管理服务器返回的内容无法读取', response.status)
  } finally {
    reader.releaseLock()
  }
}

function client(
  context: Readonly<ManagementContext>,
  transport: (request: ManagementIpcRequest, signal?: AbortSignal) => Promise<ManagementIpcResponse>,
): ManagementClient {
  let csrf: string | undefined
  return Object.freeze({
    context,
    setCsrfToken(token?: string) {
      if (token !== undefined && (typeof token !== 'string' || token.length > 4096 || /[\r\n]/.test(token)))
        invalid('管理会话验证信息无效')
      csrf = token || undefined
    },
    async request<T>(method: ManagementMethod, path: string, options: ManagementRequestOptions = {}): Promise<T> {
      if (options.signal?.aborted) throw abortReason(options.signal)
      const requestPath = checkedPath(path)
      if (
        options.accountProof !== undefined &&
        (context.transport !== 'http' ||
          method !== 'POST' ||
          requestPath !== '/session/account' ||
          typeof options.accountProof !== 'string' ||
          !/^[\x21-\x7e]{1,8192}$/.test(options.accountProof))
      )
        invalid('账户凭据只能用于当前远程服务器的管理登录')
      const request = {
        method,
        path: requestPath,
        body: snapshotBody(options.body, requestLimit(method, requestPath)),
        headers: headersFor(method, options, csrf),
      }
      let response: ManagementIpcResponse
      try {
        response = await abortable(transport(request, options.signal), options.signal)
      } catch (error) {
        if (options.signal?.aborted) throw abortReason(options.signal)
        if (error instanceof ManagementError) throw error
        throw new ManagementError('CONNECTION_FAILED', '无法连接管理服务，请检查连接后重试', 0, true)
      }
      if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599)
        throw new ManagementError('INVALID_RESPONSE', '管理服务器响应状态无效')
      if (response.status < 200 || response.status >= 300) {
        if (response.status === 401) csrf = undefined
        throw responseError(response.status, response.body)
      }
      if (
        context.serverId &&
        ['/capabilities', '/session', '/session/bootstrap', '/session/account'].includes(request.path) &&
        response.body &&
        typeof response.body === 'object' &&
        'serverId' in response.body &&
        response.body.serverId !== context.serverId
      ) {
        csrf = undefined
        throw new ManagementError('TARGET_CHANGED', '服务器身份已变化，请重新确认管理目标')
      }
      return response.body as T
    },
  })
}

export function createHttpManagementClient(
  input: ManagementContext,
  fetchImpl: typeof fetch = fetch,
): ManagementClient {
  const context = captureContext(input, 'http')
  return client(context, async (request, signal) => {
    const url = `${context.endpoint}${PREFIX}${request.path}`
    const response = await fetchImpl(url, {
      method: request.method,
      headers: request.headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      credentials: 'include',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal,
    })
    if (response.redirected || (response.url && new URL(response.url).origin !== new URL(context.endpoint).origin))
      throw new ManagementError('TARGET_CHANGED', '管理服务器地址发生变化，请重新选择目标')
    try {
      return {
        status: response.status,
        body: await readJson(response, responseLimit(request.method, request.path), signal),
      }
    } catch (error) {
      // Older servers/proxies may return an HTML 404/502. Preserve the actionable HTTP
      // status while never accepting that response as a successful management object.
      if (response.status >= 400 && error instanceof ManagementError && error.code === 'INVALID_RESPONSE')
        return { status: response.status }
      throw error
    }
  })
}

/** Only the trusted desktop shell supplies this bridge; HTTP clients never inspect window.arcadiaDesktop. */
export function createIpcManagementClient(input: ManagementContext, bridge: ManagementIpcBridge): ManagementClient {
  const context = captureContext(input, 'ipc')
  return client(context, async request => {
    // The trusted bridge supplies identity. Renderer-provided HTTP/session headers
    // must not cross IPC, including CSRF from an unrelated remote session.
    const headers = Object.fromEntries(
      Object.entries(request.headers ?? {}).filter(([name]) =>
        ['if-match', 'idempotency-key'].includes(name.toLowerCase()),
      ),
    )
    const response = await bridge({ ...request, headers })
    if (
      response.body !== undefined &&
      new TextEncoder().encode(JSON.stringify(response.body)).byteLength > responseLimit(request.method, request.path)
    )
      throw new ManagementError('INVALID_RESPONSE', '管理响应超过大小限制')
    return response
  })
}

/** A response may update a view only while its captured target generation is current. */
export function createManagementTargetGate() {
  let generation = 0
  return {
    capture: () => generation,
    isCurrent: (value: number) => value === generation,
    invalidate: () => ++generation,
  }
}
