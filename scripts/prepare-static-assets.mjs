import { readContentSources } from '../packages/content-dev/src/lib/content.ts'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const resourceOrigin = 'https://seer2-resource.yuuinih.com'
const petOrigin = 'https://seer2-pet-resource.yuuinih.com'

export function assetPath(url) {
  const parsed = new URL(url)
  const directory = parsed.origin === resourceOrigin ? 'resource' : parsed.origin === petOrigin ? 'pet' : null
  if (!directory || parsed.search || parsed.hash) throw new Error(`Unsupported official asset URL: ${url}`)
  return `${directory}${parsed.pathname}`
}

async function officialAssetHashes(repositoryRoot) {
  const assets = new Map()
  for (const source of await readContentSources(path.join(repositoryRoot, 'packs/base'))) {
    if (source.kind !== 'resources') continue
    for (const row of source.records) {
      if (!/^https?:/.test(row.source)) continue
      if (!/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error(`Missing official asset hash: ${row.source}`)
      if (assets.has(row.source) && assets.get(row.source) !== row.sha256)
        throw new Error(`Conflicting official asset hashes: ${row.source}`)
      assets.set(row.source, row.sha256)
    }
  }
  return assets
}

export async function collectOfficialAssetUrls(repositoryRoot = root) {
  return [...(await officialAssetHashes(repositoryRoot)).keys()].sort()
}

export function verifyAsset(bytes, url, sha256) {
  if (!bytes.length) throw new Error(`Empty official asset: ${url}`)
  const extension = path.extname(new URL(url).pathname)
  if (extension === '.png' && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error(`Official asset is not a PNG: ${url}`)
  }
  if (extension === '.swf' && !['FWS', 'CWS', 'ZWS'].includes(bytes.subarray(0, 3).toString())) {
    throw new Error(`Official asset is not an SWF: ${url}`)
  }
  if (
    extension === '.mp3' &&
    bytes.subarray(0, 3).toString() !== 'ID3' &&
    !(bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  ) {
    throw new Error(`Official asset is not MP3 audio: ${url}`)
  }
  if (sha256 && createHash('sha256').update(bytes).digest('hex') !== sha256)
    throw new Error(`Official asset hash mismatch: ${url}`)
  return { size: bytes.length }
}

async function download(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
}

export async function prepareStaticAssets({
  repositoryRoot = root,
  output = path.join(repositoryRoot, 'packages/web-ui/dist/official-assets'),
  cache = path.join(repositoryRoot, 'packages/web-ui/.static-assets-cache'),
} = {}) {
  const hashes = await officialAssetHashes(repositoryRoot)
  const urls = [...hashes.keys()]
  const errors = []
  let cursor = 0
  let completed = 0
  let totalBytes = 0
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (cursor < urls.length) {
        const url = urls[cursor++]
        const relative = assetPath(url)
        const cachedPath = path.join(cache, relative)
        try {
          let bytes
          try {
            bytes = await readFile(cachedPath)
            verifyAsset(bytes, url, hashes.get(url))
          } catch {
            bytes = await download(url)
            verifyAsset(bytes, url, hashes.get(url))
            await mkdir(path.dirname(cachedPath), { recursive: true })
            await writeFile(`${cachedPath}.tmp`, bytes)
            await rename(`${cachedPath}.tmp`, cachedPath)
          }
          const target = path.join(output, relative)
          await mkdir(path.dirname(target), { recursive: true })
          await writeFile(target, bytes)
          totalBytes += bytes.length
        } catch (error) {
          errors.push(`${url}: ${error.message}`)
        }
        completed++
        if (completed % 100 === 0) console.log(`Official assets: ${completed}/${urls.length}`)
      }
    }),
  )
  if (errors.length)
    throw new Error(`Official static assets are incomplete (${errors.length} failures):\n${errors.join('\n')}`)
  console.log(`Official assets ready: ${urls.length} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MiB`)
  return { files: urls.length, bytes: totalBytes }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length > 2) throw new Error('prepare-static-assets does not accept arguments')
  if (!process.env.ARCADIA_WEB_ENVIRONMENT_PROJECT?.trim()) await prepareStaticAssets()
}
