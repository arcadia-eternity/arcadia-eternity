import { cp, mkdir, readFile, writeFile, rm, access, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Verify the published pack URLs before replacing the staged website. */
export async function verifyPairedWebsite(root) {
  const pack = JSON.parse(await readFile(new URL('pack.json', root), 'utf8'))
  const presentation = JSON.parse(await readFile(new URL(pack.presentation, root), 'utf8'))
  const paths = ['index.html', 'pack-lock.yaml', pack.presentation]
  for (const files of Object.values(pack.data)) {
    for (const file of files) paths.push(`${pack.paths.dataDir}/${file}`)
  }
  if (Array.isArray(pack.locales)) {
    for (const { files } of pack.locales) for (const file of files) paths.push(`${pack.paths.localesDir}/${file}`)
  } else {
    for (const [language, namespaces] of Object.entries(pack.locales)) {
      for (const namespace of namespaces) {
        paths.push(`${pack.paths.localesDir}/${language}/${namespace}.yaml`)
        paths.push(`${pack.paths.localesDir}/${language}/${namespace}.json`)
      }
    }
  }
  for (const resource of presentation.resources ?? []) if (resource.kind === 'file') paths.push(resource.source)
  await Promise.all(
    paths.map(async path => {
      try {
        await access(join(fileURLToPath(root), path))
      } catch {
        throw new Error(`Paired website is missing a required built asset: ${path}`)
      }
    }),
  )
  return paths
}

export async function stagePairedWebsite(source, root, version) {
  // Validate before replacing a previously staged distribution.
  await verifyPairedWebsite(source)
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  // Desktop staging lives beneath the renderer output. Never publish its
  // backend runtime or in-progress staging directories as website assets.
  // Copy public entries individually: fs.cp rejects a directory copied into
  // itself before its filter can exclude the private staging subtree.
  const sourcePath = fileURLToPath(source)
  const targetPath = fileURLToPath(root)
  for (const entry of await readdir(sourcePath)) {
    if (entry === 'arcadia-server' || entry.startsWith('.')) continue
    await cp(join(sourcePath, entry), join(targetPath, entry), { recursive: true })
  }
  await writeFile(
    new URL('arcadia-web-manifest.json', root),
    JSON.stringify({ schemaVersion: 1, protocolVersion: 1, version }, null, 2),
  )
  await writeFile(new URL('arcadia-client.json', root), JSON.stringify({ schemaVersion: 1, backendOrigin: '/' }))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
  await stagePairedWebsite(
    new URL('../packages/web-ui/dist/', import.meta.url),
    new URL('../dist/web/', import.meta.url),
    version,
  )
  console.log(`Paired website ${version} staged in dist/web`)
}
