/** One administrator-supplied authority for auth, HTTP, reports and Socket.IO. */
export interface DeploymentConfig {
  schemaVersion: 1
  backendOrigin: string
}
let config: DeploymentConfig | undefined
let desktopSelection = false
let localBackendOrigin: string | undefined

export function parseDeploymentConfig(value: unknown, siteOrigin: string): DeploymentConfig {
  if (!value || typeof value !== 'object') throw new Error('缺少客户端部署配置')
  const input = value as Record<string, unknown>
  if (input.schemaVersion !== 1 || typeof input.backendOrigin !== 'string' || !input.backendOrigin.trim())
    throw new Error('客户端部署配置版本或服务器地址无效')
  const url = new URL(input.backendOrigin, siteOrigin)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('部署服务器地址必须是 HTTP 或 HTTPS 主机地址')
  if (new URL(siteOrigin).protocol === 'https:' && url.protocol !== 'https:')
    throw new Error('HTTPS 站点必须配对 HTTPS 服务器')
  return { schemaVersion: 1, backendOrigin: url.origin }
}

export async function loadDeploymentConfig(): Promise<void> {
  const remote = (window as typeof window & { arcadiaRemotePlay?: { getBootConfig(): Promise<DeploymentConfig> } })
    .arcadiaRemotePlay
  if (remote) {
    const supplied = await remote.getBootConfig()
    config = parseDeploymentConfig(supplied, supplied.backendOrigin)
    return
  }
  const desktop = window.arcadiaDesktop as typeof window.arcadiaDesktop & {
    getBackendConfig?: () => Promise<DeploymentConfig>
  }
  desktopSelection = !!desktop?.getBackendConfig
  if (desktopSelection) {
    const supplied = await desktop!.getBackendConfig!()
    config = parseDeploymentConfig(supplied, supplied.backendOrigin)
    await authorizeLocalBackend()
    return
  }
  if (import.meta.env.VITE_STATIC_MODE === '1') {
    config = { schemaVersion: 1, backendOrigin: 'http://offline.invalid' }
    return
  }
  const response = await fetch('/arcadia-client.json', { cache: 'no-store', redirect: 'error' })
  if (!response.ok) throw new Error(`无法读取客户端部署配置 (${response.status})`)
  config = parseDeploymentConfig(await response.json(), window.location.origin)
}

export function getBackendOrigin(): string {
  if (!config) throw new Error('客户端部署配置尚未加载')
  return config.backendOrigin
}

export function canSelectBackend(): boolean {
  return desktopSelection
}

export function checkBackendSelection(value: string): void {
  const trustedLocal = desktopSelection && value === localBackendOrigin
  if (!trustedLocal && value !== getBackendOrigin()) throw new Error('此网页仅连接部署者配对的服务器')
}

/** The main process owns the exact running local host; loopback addresses alone confer no authority. */
export async function authorizeLocalBackend(): Promise<void> {
  localBackendOrigin = undefined
  const status = await window.arcadiaDesktop?.getLocalBattleStatus?.()
  if (desktopSelection && status?.status === 'running') {
    const parsed = parseDeploymentConfig({ schemaVersion: 1, backendOrigin: status.url }, status.url)
    localBackendOrigin = parsed.backendOrigin
  }
}
