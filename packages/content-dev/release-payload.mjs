// Shared by the desktop packer and the content template's Actions workflow.
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { gzipSync } from 'fflate'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const sdkRequire = createRequire(require.resolve('@arcadia-eternity/content-sdk'))
const { valid, validRange } = sdkRequire('semver')

export function releasePayload(source, included, presentation) {
  if (!source.arcadia?.projectId || !source.arcadia.namespace || !source.arcadia.content || !valid(source.version))
    throw Error('发行包需要有效版本、projectId、namespace 和内容入口')
  if (typeof source.license !== 'string' || !source.license.trim()) throw Error('请先设置 package.json 的 license')
  const fields = [
    'name',
    'version',
    'description',
    'license',
    'type',
    'engines',
    'arcadia',
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
    'peerDependenciesMeta',
  ]
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const ranges = source[key]
    if (
      ranges !== undefined &&
      (!ranges ||
        typeof ranges !== 'object' ||
        Array.isArray(ranges) ||
        Object.values(ranges).some(range => typeof range !== 'string' || !range.trim() || !validRange(range)))
    )
      throw Error('发行包的 ' + key + ' 必须使用 npm 版本或范围')
  }
  const manifest = Object.fromEntries(
    fields.filter(key => Object.hasOwn(source, key)).map(key => [key, structuredClone(source[key])]),
  )
  const repository = typeof source.repository === 'object' ? source.repository?.url : source.repository
  if (typeof repository === 'string' && /^(?:git\+)?https:\/\//.test(repository)) {
    const url = new URL(repository.replace(/^git\+/, ''))
    if (url.username || url.password || url.search || url.hash) throw Error('发行仓库地址不能包含凭据、查询参数或片段')
    manifest.repository = { type: 'git', url: 'git+' + url.href }
  }
  const { arcadia } = manifest
  if (arcadia.effects) arcadia.effectArtifact = 'dist/arcadia-effects.json'
  delete arcadia.effects
  delete arcadia.effectSources
  const files = new Set(
    [...included].filter(file => /^(?:package\.json|readme(?:\..+)?|licen[cs]e(?:\..+)?|notice(?:\..+)?)$/i.test(file)),
  )
  for (const file of [
    arcadia.content,
    arcadia.presentation,
    arcadia.catalog,
    arcadia.effectArtifact,
    ...Object.values(arcadia.assets ?? {}),
    ...(presentation?.resources ?? []).filter(resource => resource.kind === 'file').map(resource => resource.source),
  ])
    if (typeof file === 'string') files.add(file)
  if (![...files].some(file => /^licen[cs]e(?:\.(?:md|txt))?$/i.test(file))) throw Error('发行包缺少 LICENSE 文件')
  for (const file of files) {
    if (
      !file ||
      /[\\:\p{Cc}]/u.test(file) ||
      file
        .split('/')
        .some(part => !part || part.startsWith('.') || /^(?:src|tests?|scripts|debug|node_modules)$/i.test(part)) ||
      /(?:\.(?:[cm]?[jt]sx?|map|pem|key|p12|pfx)|(?:^|\/)tsconfig[^/]*\.json)$/i.test(file)
    )
      throw Error('发行清单含开发文件或私密文件: ' + file)
  }
  manifest.files = [...files].sort()
  return manifest
}

// npm creates a portable tar stream, but native zlib versions can encode it
// differently. Use the same pinned compressor for desktop and hosted builds.
export async function normalizeReleaseArchive(path) {
  const tar = gunzipSync(await readFile(path), { maxOutputLength: 256 * 1024 * 1024 })
  const bytes = gzipSync(tar, { level: 9, mtime: 0 })
  await writeFile(path, bytes)
  return {
    integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
    shasum: createHash('sha1').update(bytes).digest('hex'),
    size: bytes.length,
  }
}
