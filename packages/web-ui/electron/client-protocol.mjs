import { protocol } from 'electron'
import path from 'node:path'
import { readFile, realpath } from 'node:fs/promises'

export const CLIENT_ORIGIN = 'arcadia-client://app'
export const CLIENT_URL = `${CLIENT_ORIGIN}/index.html`
protocol.registerSchemesAsPrivileged([
  { scheme: 'arcadia-client', privileges: { standard: true, secure: true, corsEnabled: true, supportFetchAPI: true } },
])
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
}

/** Static bundled application files only. This handler never fetches network URLs. */
export function registerClientProtocol(targetSession, directory) {
  targetSession.protocol.handle('arcadia-client', async request => {
    try {
      const url = new URL(request.url)
      if (
        url.protocol !== 'arcadia-client:' ||
        url.host !== 'app' ||
        url.username ||
        url.password ||
        !['GET', 'HEAD'].includes(request.method)
      )
        return new Response(null, { status: 403 })
      const pathname = decodeURIComponent(url.pathname)
      if (pathname.includes('\\') || pathname.includes('\0')) return new Response(null, { status: 403 })
      const root = await realpath(directory)
      let file = path.resolve(root, '.' + pathname)
      const inside = candidate => candidate === root || candidate.startsWith(root + path.sep)
      if (!inside(file)) return new Response(null, { status: 403 })
      // History-mode app routes map to index.html; missing assets do not.
      if (!path.extname(file)) file = path.join(root, 'index.html')
      file = await realpath(file)
      if (!inside(file)) return new Response(null, { status: 403 })
      return new Response(request.method === 'HEAD' ? null : await readFile(file), {
        headers: {
          'content-type': mime[path.extname(file)] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        },
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}
