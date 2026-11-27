import { lookup, type LookupAddress } from 'node:dns'
import { request } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { WorkshopError, type WorkshopFetch } from '@arcadia-eternity/pack-loader/workshop'

const reserved = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  reserved.addSubnet(network, prefix, 'ipv4')
const globalUnicast = new BlockList()
globalUnicast.addSubnet('2000::', 3, 'ipv6')
// Teredo, documentation and 6to4 addresses can embed or stand for non-public IPv4 hosts.
for (const [network, prefix] of [
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
] as const)
  reserved.addSubnet(network, prefix, 'ipv6')

/** A public unicast address: no loopback, private, link-local, shared, multicast, documentation or mapped range. */
export function isPublicAddress(address: string) {
  const family = isIP(address)
  if (family === 4) return !reserved.check(address, 'ipv4')
  if (family === 6) return globalUnicast.check(address, 'ipv6') && !reserved.check(address, 'ipv6')
  return false
}

const forbidden = (host: string) => new WorkshopError('WORKSHOP_ADDRESS_FORBIDDEN', host)

/** Resolves every address and refuses the connection unless all are public, so DNS cannot redirect to the host. */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, '', 0)
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address)))
      return callback(forbidden(hostname), '', 0)
    if (options.all) return (callback as unknown as (error: null, list: LookupAddress[]) => void)(null, addresses)
    callback(null, addresses[0].address, addresses[0].family)
  })
}

/**
 * Registry fetch for standalone servers. Root mirrors are chosen by registry operators, not by the host, so only
 * HTTPS to public addresses is allowed; redirects, credentials and local addresses are refused.
 */
export const publicWorkshopFetch: WorkshopFetch = (url, maxBytes, signal) =>
  new Promise((resolve, reject) => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
      return reject(new WorkshopError('WORKSHOP_URL_INVALID'))
    const host = parsed.hostname.replace(/^\[|\]$/g, '')
    if (isIP(host) && !isPublicAddress(host)) return reject(forbidden(host))
    const req = request(
      parsed,
      { method: 'GET', signal, lookup: publicLookup, headers: { accept: 'application/json' } },
      response => {
        const status = response.statusCode ?? 0
        if (status === 404 || status === 403) {
          response.resume()
          return resolve(null)
        }
        if (status < 200 || status >= 300) {
          response.resume()
          return reject(new WorkshopError('WORKSHOP_FETCH_FAILED', `HTTP ${status}`))
        }
        if (Number(response.headers['content-length'] ?? 0) > maxBytes) {
          response.destroy()
          return reject(new WorkshopError('WORKSHOP_LIMIT'))
        }
        const chunks: Buffer[] = []
        let total = 0
        response.on('data', (chunk: Buffer) => {
          total += chunk.byteLength
          if (total > maxBytes) {
            response.destroy()
            reject(new WorkshopError('WORKSHOP_LIMIT'))
          } else chunks.push(chunk)
        })
        response.on('error', reject)
        response.on('end', () => {
          if (total <= maxBytes) resolve(new Uint8Array(Buffer.concat(chunks, total)))
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
