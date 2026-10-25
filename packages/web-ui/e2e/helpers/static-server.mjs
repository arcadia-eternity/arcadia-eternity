import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../dist/', import.meta.url))
const prefix = '/game/'
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.wasm': 'application/wasm',
  '.swf': 'application/x-shockwave-flash',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

// Deliberately no application routes, fallback index, API, or proxy.
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    if (!['GET', 'HEAD'].includes(request.method) || !pathname.startsWith(prefix)) {
      response.writeHead(404).end()
      return
    }
    const relative = pathname.slice(prefix.length) || 'index.html'
    // Static hosts consume these deployment settings rather than serving them.
    if (['_headers', '_redirects'].includes(relative)) {
      response.writeHead(404).end()
      return
    }
    const file = resolve(root, relative)
    if (!file.startsWith(resolve(root) + sep) || !(await stat(file)).isFile()) {
      response.writeHead(404).end()
      return
    }
    const content = await readFile(file)
    response.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': 'no-store',
    })
    response.end(request.method === 'HEAD' ? undefined : content)
  } catch {
    response.writeHead(404).end()
  }
}).listen(4179, '127.0.0.1', () => console.log('Serving built files at http://127.0.0.1:4179/game/'))
