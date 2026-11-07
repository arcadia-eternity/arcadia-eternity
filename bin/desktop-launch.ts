import { normalizeServerSettings, type ManagementService } from '@arcadia-eternity/server'

export interface DesktopLaunch {
  name: string
  host: string
  port: number
  publicOrigin: string | null
  officialContent?: true
}

/** Accepted only on the private desktop CLI channel, before binding a listener. */
export function parseDesktopLaunch(raw: string): DesktopLaunch {
  const value = JSON.parse(raw)
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(key => !['name', 'host', 'port', 'publicOrigin', 'officialContent'].includes(key)) ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 80 ||
    !['127.0.0.1', '0.0.0.0'].includes(value.host) ||
    typeof value.port !== 'number' ||
    (value.publicOrigin !== null && typeof value.publicOrigin !== 'string') ||
    (value.officialContent !== undefined && value.officialContent !== true)
  )
    throw new Error('Invalid desktop launch configuration')
  normalizeServerSettings({
    host: value.host,
    port: value.port,
    ...(value.publicOrigin === null ? {} : { publicOrigin: value.publicOrigin }),
  })
  return { ...value, name: value.name.trim() }
}

/** Persist through the same revision-checked management interface as the settings page. */
export async function saveDesktopLaunch(management: ManagementService, launch: DesktopLaunch) {
  const listed = await management.localRequest({ method: 'GET', path: '/servers' })
  const server = (listed.body as { servers?: { id: string; revision: number }[] })?.servers?.[0]
  if (listed.status !== 200 || !server) throw new Error('Desktop server configuration unavailable')
  const { name, host, port, publicOrigin } = launch
  const saved = await management.localRequest({
    method: 'PATCH',
    path: `/servers/${encodeURIComponent(server.id)}`,
    headers: { 'if-match': String(server.revision) },
    body: { name, settings: { host, port, publicOrigin } },
  })
  if (saved.status !== 200) throw new Error('Could not persist desktop launch configuration')
}
