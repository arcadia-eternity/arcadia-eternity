import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
const root = new URL('../dist/web/', import.meta.url)
await rm(root, { recursive: true, force: true })
await mkdir(root, { recursive: true })
await cp(new URL('../packages/web-ui/dist/', import.meta.url), root, { recursive: true })
await writeFile(
  new URL('arcadia-web-manifest.json', root),
  JSON.stringify({ schemaVersion: 1, protocolVersion: 1, version }, null, 2),
)
await writeFile(new URL('arcadia-client.json', root), JSON.stringify({ schemaVersion: 1, backendOrigin: '/' }))
console.log(`Paired website ${version} staged in dist/web`)
