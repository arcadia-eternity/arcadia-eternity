import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const dist = resolve(import.meta.dirname, '../dist')
async function inventory(directory, prefix = '') {
  const files = []
  for (const name of (await readdir(directory)).sort()) {
    const path = resolve(directory, name)
    const relative = `${prefix}${name}`
    if ((await stat(path)).isDirectory()) files.push(...(await inventory(path, `${relative}/`)))
    else if (!relative.startsWith('offline-') && !relative.endsWith('.map')) {
      const data = await readFile(path)
      files.push({ path: relative, size: data.byteLength, sha256: createHash('sha256').update(data).digest('hex') })
    }
  }
  return files
}
const files = await inventory(dist)
const version = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 20)
const worker = `offline-worker-${version}.js`
const manifest = { version, worker, bytes: files.reduce((sum, file) => sum + file.size, 0), files }
await writeFile(resolve(dist, 'offline-manifest.json'), JSON.stringify(manifest))
// A versioned worker URL is installed only after the entire matching build is saved.
// API requests, third-party content and user data are never part of this cache.
await writeFile(
  resolve(dist, worker),
  `
const VERSION = ${JSON.stringify(version)};
const PATHS = new Set(${JSON.stringify(files.map(file => file.path))});
const ROOT = new URL(self.registration.scope);
const CACHE = 'arcadia-static:' + ROOT.pathname + ':' + VERSION;
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  const relative = url.pathname.slice(ROOT.pathname.length) || 'index.html';
  if (!PATHS.has(relative)) return;
  event.respondWith((async () => {
    try { return await fetch(event.request); }
    catch (error) {
      const cache = await caches.open(CACHE);
      if (!await cache.match(new URL('__offline_ready__', ROOT).href)) throw error;
      const cached = await cache.match(new URL(relative, ROOT).href);
      if (!cached) throw error;
      const range = event.request.headers.get('range');
      if (range) {
        const match = /^bytes=(\\d+)-(\\d*)$/.exec(range);
        if (match) {
          const bytes = await cached.arrayBuffer();
          const start = Number(match[1]);
          const end = Math.min(match[2] ? Number(match[2]) : bytes.byteLength - 1, bytes.byteLength - 1);
          if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + bytes.byteLength } });
          const headers = new Headers(cached.headers);
          headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + bytes.byteLength);
          headers.set('Content-Length', String(end - start + 1));
          return new Response(bytes.slice(start, end + 1), { status: 206, headers });
        }
      }
      return cached;
    }
  })());
});
`,
)
console.log(`Offline manifest: ${files.length} files, ${(manifest.bytes / 1048576).toFixed(1)} MiB, ${version}`)
