/** Connection location is independent of who operates the server. */
export function connectionPresentation(input: {
  connected: boolean
  endpoint: string
  pageOrigin: string
  localEndpoint?: string
}) {
  if (!input.connected) return { label: '离线', detail: '当前未连接服务器', kind: 'offline' as const }
  const endpoint = new URL(input.endpoint)
  const kind =
    input.localEndpoint && endpoint.origin === new URL(input.localEndpoint).origin
      ? 'local'
      : endpoint.origin === input.pageOrigin
        ? 'website'
        : 'remote'
  const location = kind === 'local' ? '本机服务器' : kind === 'website' ? '当前网页的服务器' : '远程服务器'
  const short = kind === 'local' ? '本机' : kind === 'website' ? '本站' : '远程'
  return { label: `${short} · ${endpoint.host}`, detail: `已连接${location}：${endpoint.origin}`, kind }
}
