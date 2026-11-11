import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import express, { type Express } from 'express'

/** The server only serves a website explicitly built for this distribution contract. */
export function mountPairedWebsite(app: Express, directory: string, autoConnect = true): void {
  const root = resolve(directory)
  const manifest = JSON.parse(readFileSync(resolve(root, 'arcadia-web-manifest.json'), 'utf8')) as {
    schemaVersion?: number
    protocolVersion?: number
    version?: string
  }
  if (
    manifest.schemaVersion !== 1 ||
    manifest.protocolVersion !== 1 ||
    typeof manifest.version !== 'string' ||
    !manifest.version
  )
    throw new Error('Paired website is incompatible; rebuild the server distribution')
  if (!statSync(resolve(root, 'index.html')).isFile()) throw new Error('Paired website index.html is missing')
  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', "frame-src 'none'")
    next()
  })
  app.get('/arcadia-client.json', (_req, res) =>
    res.set('Cache-Control', 'no-store').json({ schemaVersion: 1, backendOrigin: '/', autoConnect }),
  )
  app.use((req, res, next) => {
    if (/^\/(?:api|socket\.io|health)(?:\/|$)/.test(req.path)) {
      res.status(404).json({ code: 'NOT_FOUND' })
      return
    }
    next()
  })
  app.use(express.static(root, { etag: false, lastModified: false, cacheControl: false, index: false }))
  const routes = new Set([
    '/',
    '/lobby',
    '/account',
    '/management',
    '/servers',
    '/team-builder',
    '/dex',
    '/download',
    '/local-battle',
    '/local-battle-reports',
    '/room',
    '/battle',
    '/content',
    '/settings/local-service',
    '/content/development',
    '/content/edit',
    '/storage',
  ])
  app.use((req, res, next) => {
    // Only actual client routes receive HTML. Missing resources and service paths remain errors.
    if (
      !['GET', 'HEAD'].includes(req.method) ||
      !req.accepts('html') ||
      !(
        routes.has(req.path.replace(/\/$/, '') || '/') ||
        /^\/(?:room\/[^/]+|dex\/(?:species|skill|mark)\/[^/]+|dex\/type-chart|local-battle-reports\/[^/]+\/play|content\/edit\/[^/]+)$/.test(
          req.path,
        )
      )
    )
      return next()
    res.sendFile('index.html', { root, cacheControl: false, lastModified: false })
  })
}
