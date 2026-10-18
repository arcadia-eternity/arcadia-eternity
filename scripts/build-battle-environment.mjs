import { rolldown } from 'rolldown'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

export function identifyEnvironmentArtifact(code) {
  const digest = domain => createHash('sha256').update(`${domain}\0`).update(code).digest('hex')
  // One bundled runtime currently contains core, schemas, capabilities and restoration code.
  // Both identities cover all of it, conservatively invalidating either boundary on any change.
  return { formatVersion: 1, coreBuildId: digest('arcadia-core/1'), registryBuildId: digest('arcadia-registry/1') }
}
export async function buildEnvironmentArtifact() {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const dir = resolve(root, 'packages/battle/dist')
  const bundle = await rolldown({ cwd: root, input: resolve(root, 'packages/battle/v4.ts'), platform: 'browser' })
  try {
    const { output } = await bundle.generate({ format: 'esm', codeSplitting: false, minify: false })
    if (output.length !== 1 || output[0].type !== 'chunk')
      throw new Error('Environment must be one executable artifact')
    const code = output[0].code
    const identity = identifyEnvironmentArtifact(code)
    await mkdir(dir, { recursive: true })
    await writeFile(resolve(dir, 'environment-runtime.mjs'), code)
    await writeFile(resolve(dir, 'environment-build.json'), JSON.stringify(identity, null, 2) + '\n')
    return identity
  } finally {
    await bundle.close()
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await buildEnvironmentArtifact()))
