import { isIP } from 'node:net'
import { networkInterfaces } from 'node:os'

const wildcard = (host: string) => host === '0.0.0.0' || host === '::'
const loopback = (host: string) => host === 'localhost' || host === '::1' || /^127\./.test(host)
const originFor = (host: string, port: number) => `http://${isIP(host) === 6 ? `[${host}]` : host}:${port}`

/** Listener readiness comes from the private child channel, never renderer data or logs. */
export function desktopListener(input: unknown, serverId: string, interfaces = networkInterfaces()) {
  const message = input as {
    type?: unknown
    serverId?: unknown
    host?: unknown
    port?: number
    publicOrigin?: string
  } | null
  if (
    message?.type !== 'arcadia.desktop.listener' ||
    message.serverId !== serverId ||
    typeof message.host !== 'string' ||
    !message.host ||
    message.host.length > 253 ||
    (!isIP(message.host) &&
      !message.host.split('.').every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))) ||
    message.port === undefined ||
    !Number.isInteger(message.port) ||
    message.port < 1 ||
    message.port > 65535
  )
    throw new Error('Invalid desktop listener')
  const { host, port } = message
  const availableHosts = [
    ...new Set(
      Object.values(interfaces).flatMap(addresses =>
        (addresses ?? [])
          .filter(address => !address.internal && address.family === 'IPv4' && !address.address.startsWith('169.254.'))
          .map(address => address.address),
      ),
    ),
  ].sort()
  let publicOrigin
  if (message.publicOrigin !== undefined) {
    const parsed = new URL(message.publicOrigin)
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.origin !== message.publicOrigin ||
      parsed.username ||
      parsed.password
    )
      throw new Error('Invalid desktop public origin')
    publicOrigin = parsed.origin
  }
  const scope: 'local' | 'network' = loopback(host) ? 'local' : 'network'
  const url = originFor(host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host, port)
  const inviteUrls =
    scope === 'local'
      ? []
      : wildcard(host)
        ? availableHosts.map(address => originFor(address, port))
        : [originFor(host, port)]
  // A configured proxy address is an operator declaration, not a reachability test.
  if (publicOrigin) {
    const address = new URL(publicOrigin).hostname.replace(/^\[|\]$/g, '')
    if (!wildcard(address) && !loopback(address)) inviteUrls.unshift(publicOrigin)
  }
  return {
    url,
    network: {
      host,
      port,
      scope,
      ...(publicOrigin ? { publicOrigin } : {}),
      availableHosts,
      inviteUrls: [...new Set(inviteUrls)],
    },
  }
}
