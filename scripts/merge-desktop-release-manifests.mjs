import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Builder 26.15.3 uses latest* for the configured GitHub provider even for
// prereleases; GitHub's release prerelease flag selects the update audience.
// Other provider/channel layouts are rejected rather than silently omitted.
const targets = [
  { platform: 'darwin', arch: 'x64', os: 'mac', extensions: ['zip'], manifest: 'latest-mac.yml' },
  { platform: 'darwin', arch: 'arm64', os: 'mac', extensions: ['zip'], manifest: 'latest-mac.yml' },
  { platform: 'win32', arch: 'x64', os: 'win', extensions: ['exe', 'zip'], manifest: 'latest.yml' },
  { platform: 'linux', arch: 'x64', os: 'linux', extensions: ['AppImage'], manifest: 'latest-linux.yml' },
]
const targetKey = value => `${value.platform}/${value.arch}`
const fail = message => {
  throw new Error(`Desktop release rejected: ${message}`)
}

export function releaseVersion(value) {
  const version = typeof value === 'string' ? value.replace(/^v/, '') : ''
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      version,
    )
  if (
    !match ||
    version.length > 128 ||
    match.slice(1, 4).some(part => !Number.isSafeInteger(Number(part))) ||
    match[4]?.split('.').some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))
  )
    fail('version must be a valid SemVer, optionally prefixed with v')
  return version
}

async function regularFile(file) {
  const info = await lstat(file)
  if (!info.isFile()) fail(`expected a regular file: ${file}`)
  return info
}

async function hashFile(file) {
  await regularFile(file)
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('base64')
}

async function smallFile(file) {
  if ((await regularFile(file)).size > 1024 * 1024) fail(`metadata is too large: ${file}`)
  return readFile(file, 'utf8')
}

const canonical = value =>
  JSON.stringify(value, function (_key, item) {
    return item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map(key => [key, item[key]]),
        )
      : item
  })

/** Merge only artifacts produced by the four successful native build jobs.
 * Inputs are immutable Actions artifacts downloaded by their exact IDs. This
 * helper performs no publishing and never accepts a URL or path from a manifest.
 */
export async function mergeDesktopReleaseManifests({ input, output, version: requested, commit, sources }) {
  const { default: YAML } = await import('yaml')
  const version = releaseVersion(requested)
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) fail('source commit must be a full Git SHA')
  if (!Array.isArray(sources) || sources.length !== targets.length)
    fail('all four native artifact sources are required')
  const ids = new Set(),
    names = new Set(),
    sourceMap = new Map()
  for (const source of sources) {
    if (!Number.isSafeInteger(source?.artifactId) || source.artifactId <= 0 || ids.has(source.artifactId))
      fail('artifact IDs must be unique positive integers')
    if (
      typeof source.artifactName !== 'string' ||
      !/^desktop-release-[0-9]+-[0-9]+-(?:darwin|win32|linux)-(?:arm64|x64)$/.test(source.artifactName) ||
      basename(source.artifactName) !== source.artifactName ||
      names.has(source.artifactName)
    )
      fail('invalid or duplicate artifact source name')
    const key = targetKey(source)
    if (!targets.some(target => targetKey(target) === key) || sourceMap.has(key))
      fail('invalid or duplicate native target')
    if (!source.artifactName.endsWith(`-${source.platform}-${source.arch}`))
      fail('artifact source target does not match its name')
    if (source.digest != null && !/^sha256:[a-f0-9]{64}$/.test(source.digest)) fail('invalid artifact digest')
    ids.add(source.artifactId)
    names.add(source.artifactName)
    sourceMap.set(key, source)
  }
  if (!(await lstat(input)).isDirectory()) fail('input must be a physical directory')
  const actualSources = await readdir(input)
  if (actualSources.length !== names.size || actualSources.some(name => !names.has(name)))
    fail('unexpected or missing input artifact')
  const assets = new Map(),
    manifests = new Map(),
    receipts = []
  for (const target of targets) {
    const source = sourceMap.get(targetKey(target))
    const directory = join(input, source.artifactName)
    if (!(await lstat(directory)).isDirectory()) fail('artifact source must be a physical directory')
    const receipt = JSON.parse(await smallFile(join(directory, 'desktop-build.json')))
    if (
      receipt.format !== 'arcadia.desktop-release-build/1' ||
      receipt.version !== version ||
      receipt.commit !== commit ||
      receipt.platform !== target.platform ||
      receipt.arch !== target.arch
    )
      fail(`build receipt does not match ${targetKey(target)}`)
    // '+' is valid SemVer but not an electron-builder GitHub asset filename.
    const prefix = `Arcadia-Eternity-${version.replaceAll('+', '-')}-${target.os}-${target.arch}`
    const required = target.extensions.map(extension => `${prefix}.${extension}`)
    const allowed = new Set([
      ...required,
      ...required.map(name => `${name}.blockmap`),
      target.manifest,
      'desktop-build.json',
    ])
    const entries = await readdir(directory)
    if (entries.some(name => !allowed.has(name)) || required.some(name => !entries.includes(name)))
      fail(`unexpected or missing asset in ${targetKey(target)}`)
    for (const name of entries.filter(name => required.includes(name) || name.endsWith('.blockmap'))) {
      if (assets.has(name)) fail(`duplicate asset: ${name}`)
      const file = join(directory, name)
      const info = await regularFile(file)
      assets.set(name, { file, size: info.size, sha512: await hashFile(file), sourceId: source.artifactId })
    }
    const text = await smallFile(join(directory, target.manifest))
    const manifest = YAML.parse(text)
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.version !== version)
      fail(`manifest version does not match ${targetKey(target)}`)
    if (!Array.isArray(manifest.files) || manifest.files.length !== 1)
      fail('each native update manifest must describe one installer')
    const entry = manifest.files[0]
    const expectedUpdate = required[0]
    const asset = assets.get(expectedUpdate)
    if (!entry || entry.url !== expectedUpdate || entry.sha512 !== asset.sha512 || entry.size !== asset.size)
      fail(`update manifest does not match its artifact: ${targetKey(target)}`)
    if (manifest.path !== entry.url || manifest.sha512 !== entry.sha512)
      fail('legacy update path/hash does not match the installer')
    if (typeof manifest.releaseDate !== 'string' || !Number.isFinite(Date.parse(manifest.releaseDate)))
      fail('invalid manifest release date')
    manifests.set(targetKey(target), { name: target.manifest, manifest, text })
    receipts.push({ ...source, build: receipt })
  }
  const intel = manifests.get('darwin/x64').manifest
  const arm = manifests.get('darwin/arm64').manifest
  const common = ({ files: _files, path: _path, sha512: _hash, releaseDate: _date, ...rest }) => rest
  if (canonical(common(intel)) !== canonical(common(arm))) fail('Mac manifests disagree on common release metadata')
  const mergedMac = {
    ...intel,
    files: [...intel.files, ...arm.files],
    releaseDate: [intel.releaseDate, arm.releaseDate].sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1),
  }
  const finalManifests = new Map([
    ['latest-mac.yml', YAML.stringify(mergedMac)],
    ['latest.yml', manifests.get('win32/x64').text],
    ['latest-linux.yml', manifests.get('linux/x64').text],
  ])
  // Validate every source before creating an output that a publisher could use.
  await mkdir(output)
  const inventory = []
  for (const [name, asset] of assets) {
    const destination = join(output, name)
    await copyFile(asset.file, destination, constants.COPYFILE_EXCL)
    if ((await hashFile(destination)) !== asset.sha512) fail(`artifact changed while copying: ${name}`)
    inventory.push({ name, size: asset.size, sha512: asset.sha512, sourceId: asset.sourceId })
  }
  for (const [name, text] of finalManifests) {
    await writeFile(join(output, name), text, { flag: 'wx' })
    inventory.push({ name, size: Buffer.byteLength(text), sha512: createHash('sha512').update(text).digest('base64') })
  }
  const provenance = { format: 'arcadia.desktop-release/1', version, commit, sources: receipts, files: inventory }
  await writeFile(join(output, 'desktop-release-provenance.json'), JSON.stringify(provenance, null, 2) + '\n', {
    flag: 'wx',
  })
  return provenance
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output, requested, commit, sourceFile] = process.argv.slice(2)
  if (process.argv.length !== 7)
    throw new Error(
      'Usage: node scripts/merge-desktop-release-manifests.mjs <input> <new-output> <version> <commit> <artifact-sources.json>',
    )
  await mergeDesktopReleaseManifests({
    input,
    output,
    version: requested,
    commit,
    sources: JSON.parse(await smallFile(sourceFile)),
  })
}
