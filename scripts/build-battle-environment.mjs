import { rolldown } from 'rolldown'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

// Ship original notices for every dependency included in the bundled runtime.
export async function bundledNotices(moduleIds) {
  const packages = new Map()
  for (const id of moduleIds) {
    if (!id.includes('/node_modules/')) continue
    let directory = dirname(id)
    while (directory.includes('/node_modules/')) {
      try {
        const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
        if (manifest.name && manifest.version) {
          packages.set(`${manifest.name}@${manifest.version}`, directory)
          break
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      directory = dirname(directory)
    }
  }
  const notices = ['# Bundled third-party notices\n']
  for (const [name, directory] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const files = (await readdir(directory)).filter(name => /^(license|licence|copying|notice)([.-]|$)/i.test(name))
    if (!files.some(name => /^(license|licence|copying)([.-]|$)/i.test(name))) {
      if (name !== 'jsondiffpatch@0.7.6') throw new Error(`Missing bundled dependency license: ${name}`)
      notices.push(
        `## ${name}\n\n${await readFile(new URL('./release-license-reference/jsondiffpatch-0.7.6.txt', import.meta.url), 'utf8')}`,
      )
      continue
    }
    notices.push(`## ${name}\n`)
    for (const file of files.sort()) notices.push(`### ${file}\n\n${await readFile(join(directory, file), 'utf8')}`)
  }
  return notices.join('\n\n') + '\n'
}

export function identifyEnvironmentArtifact(code) {
  const digest = domain => createHash('sha256').update(`${domain}\0`).update(code).digest('hex')
  // One bundled runtime currently contains core, schemas, capabilities and restoration code.
  // Both identities cover all of it, conservatively invalidating either boundary on any change.
  return { formatVersion: 1, coreBuildId: digest('arcadia-core/1'), registryBuildId: digest('arcadia-registry/1') }
}
export async function buildEnvironmentArtifact() {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const dir = resolve(root, 'packages/battle/dist')
  const bundle = await rolldown({ cwd: root, input: resolve(root, 'packages/battle/engine.ts'), platform: 'browser' })
  try {
    const { output } = await bundle.generate({ format: 'esm', codeSplitting: false, minify: false })
    if (output.length !== 1 || output[0].type !== 'chunk')
      throw new Error('Environment must be one executable artifact')
    const code = output[0].code
    const identity = identifyEnvironmentArtifact(code)
    await mkdir(dir, { recursive: true })
    await writeFile(resolve(dir, 'THIRD_PARTY_NOTICES.md'), await bundledNotices(Object.keys(output[0].modules)))
    await writeFile(resolve(dir, 'environment-runtime.mjs'), code)
    await writeFile(resolve(dir, 'environment-build.json'), JSON.stringify(identity, null, 2) + '\n')
    await writeFile(
      resolve(dir, 'native-build.mjs'),
      `export const nativeBuildIdentity = Object.freeze(${JSON.stringify(identity)});\n`,
    )
    await writeFile(
      resolve(dir, 'native-build.d.ts'),
      'export declare const nativeBuildIdentity: Readonly<{ formatVersion: 1; coreBuildId: string; registryBuildId: string }>;\n',
    )
    return identity
  } finally {
    await bundle.close()
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await buildEnvironmentArtifact()))
