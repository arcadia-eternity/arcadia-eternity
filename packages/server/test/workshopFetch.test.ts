import { createServer } from 'node:https'
import { expect, it } from 'vitest'
import { isPublicAddress, publicWorkshopFetch } from '../src/runtime/management/workshop-fetch'

it('classifies only public unicast addresses as reachable', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '198.18.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
    '2002:7f00:1::',
    'localhost',
  ])
    expect(isPublicAddress(address), address).toBe(false)
  for (const address of ['185.199.108.153', '8.8.8.8', '2606:50c0:8000::153'])
    expect(isPublicAddress(address)).toBe(true)
})

it('refuses non-HTTPS, credentialed, literal local and DNS-resolved local registry URLs', async () => {
  const signal = AbortSignal.timeout(10_000)
  await expect(publicWorkshopFetch('http://example.com/root/1.json', 1024, signal)).rejects.toMatchObject({
    code: 'WORKSHOP_URL_INVALID',
  })
  await expect(publicWorkshopFetch('https://user:pw@example.com/x', 1024, signal)).rejects.toMatchObject({
    code: 'WORKSHOP_URL_INVALID',
  })
  for (const url of ['https://127.0.0.1/x', 'https://[::1]/x', 'https://169.254.169.254/x', 'https://localhost/x'])
    await expect(publicWorkshopFetch(url, 1024, signal), url).rejects.toMatchObject({
      code: 'WORKSHOP_ADDRESS_FORBIDDEN',
    })
})

it('does not connect to a local HTTPS server reached by name', async () => {
  let connected = false
  const server = createServer(() => {
    connected = true
  })
  server.on('connection', () => (connected = true))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  try {
    await expect(
      publicWorkshopFetch(`https://localhost:${port}/snapshot.json`, 1024, AbortSignal.timeout(10_000)),
    ).rejects.toMatchObject({ code: 'WORKSHOP_ADDRESS_FORBIDDEN' })
    expect(connected).toBe(false)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

it.skipIf(process.env.ARCADIA_LIVE_WORKSHOP !== '1')('fetches the live official snapshot', async () => {
  const bytes = await publicWorkshopFetch(
    'https://arcadia-eternity.github.io/arcadia-workshop/snapshot.json',
    1 << 20,
    AbortSignal.timeout(30_000),
  )
  expect(JSON.parse(new TextDecoder().decode(bytes!)).signed.type).toBe('snapshot')
})
