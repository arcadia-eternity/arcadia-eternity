import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import express from 'express'
import { mountPairedWebsite } from '../src/standalone/website'

let directory: string
let server: Server | undefined
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'arcadia-web-'))
  await writeFile(
    join(directory, 'arcadia-web-manifest.json'),
    JSON.stringify({ schemaVersion: 1, protocolVersion: 1, version: '3.4.2' }),
  )
  await writeFile(join(directory, 'index.html'), '<html>paired site</html>')
})
afterEach(async () => {
  if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve()))
  await rm(directory, { recursive: true, force: true })
})
it('serves config and deep links while missing service/resource paths remain errors', async () => {
  const app = express()
  mountPairedWebsite(app, directory)
  app.use((_req, res) => {
    res.status(404).json({ code: 'NOT_FOUND' })
  })
  server = createServer(app)
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const base = `http://127.0.0.1:${address.port}`
  expect(await (await fetch(`${base}/arcadia-client.json`)).json()).toEqual({ schemaVersion: 1, backendOrigin: '/' })
  for (const path of ['/', '/room/invite', '/team-builder', '/dex/species/pet', '/battle-reports/id/preview']) {
    const response = await fetch(`${base}${path}`, { headers: { Accept: 'text/html' } })
    expect(response.status, path).toBe(200)
    expect(await response.text()).toContain('paired site')
  }
  for (const path of [
    '/api/v1/missing',
    '/api/v1/environments/id/assets/hash',
    '/socket.io/missing',
    '/assets/missing.swf',
    '/resource/missing.png',
    '/unknown',
  ]) {
    const response = await fetch(`${base}${path}`, { headers: { Accept: 'text/html' } })
    expect(response.status, path).toBe(404)
    expect(await response.text()).not.toContain('paired site')
  }
})
it('fails explicitly for missing or incompatible distribution files', async () => {
  await writeFile(
    join(directory, 'arcadia-web-manifest.json'),
    JSON.stringify({ schemaVersion: 1, protocolVersion: 2, version: '3.4.2' }),
  )
  expect(() => mountPairedWebsite(express(), directory)).toThrow('incompatible')
  await rm(join(directory, 'arcadia-web-manifest.json'))
  expect(() => mountPairedWebsite(express(), directory)).toThrow()
})
