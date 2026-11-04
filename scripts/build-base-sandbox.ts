import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compileEffectModule } from '../packages/pack-loader/src/npm/effect-artifact.ts'

/** Share the exact compiler and output between one-shot builds and the native content watcher. */
export async function buildBaseSandboxArtifact(onDependency?: (file: string) => void) {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const artifact = await compileEffectModule(
    fileURLToPath(new URL('../packs/base/src/sandbox-effects.ts', import.meta.url)),
    root,
    '@arcadia-eternity/data-pack-base',
    onDependency,
  )
  const output = new URL('../packs/base/dist/', import.meta.url)
  await mkdir(output, { recursive: true })
  await writeFile(new URL('sandbox.js', output), `export const officialEffectArtifact = ${JSON.stringify(artifact)};\n`)
  await writeFile(
    new URL('sandbox.d.ts', output),
    `import type { EffectModuleArtifact } from '@arcadia-eternity/battle/v4/sandbox';\nexport declare const officialEffectArtifact: EffectModuleArtifact;\n`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildBaseSandboxArtifact()
