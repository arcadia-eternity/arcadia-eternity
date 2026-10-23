import { rolldown } from 'rolldown'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

/** Host identity covers both the engine and the installed native content implementation. */
export function identifyBaseEnvironmentArtifact(code, core) {
  if (core.formatVersion !== 1 || !/^[a-f0-9]{64}$/.test(core.coreBuildId))
    throw new Error('Invalid engine build identity')
  return {
    formatVersion: 1,
    coreBuildId: core.coreBuildId,
    registryBuildId: createHash('sha256')
      .update('arcadia-base-registry/1\0')
      .update(core.coreBuildId)
      .update('\0')
      .update(code)
      .digest('hex'),
  }
}

export async function buildBaseEnvironmentArtifact() {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const dir = resolve(root, 'packs/base/dist')
  const core = JSON.parse(await readFile(resolve(root, 'packages/battle/dist/environment-build.json'), 'utf8'))
  const bundle = await rolldown({ cwd: root, input: resolve(root, 'packs/base/native.ts'), platform: 'browser' })
  try {
    const { output } = await bundle.generate({ format: 'esm', codeSplitting: false, minify: false })
    if (output.length !== 1 || output[0].type !== 'chunk')
      throw new Error('Native content must produce one executable identity artifact')
    const code = output[0].code
    const identity = identifyBaseEnvironmentArtifact(code, core)
    await mkdir(dir, { recursive: true })
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
  console.log(JSON.stringify(await buildBaseEnvironmentArtifact()))
