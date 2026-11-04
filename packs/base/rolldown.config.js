import { defineConfig } from 'rolldown'
import { fileURLToPath } from 'node:url'
import { buildBaseEnvironmentArtifact } from '../../scripts/build-base-environment.mjs'
import { buildBaseSandboxArtifact } from '../../scripts/build-base-sandbox.ts'

export default defineConfig({
  input: { native: 'native.ts' },
  output: { format: 'esm', dir: 'dist' },
  tsconfig: true,
  plugins: [
    {
      name: 'base-content-watch-artifacts',
      async buildStart() {
        if (this.meta.watchMode) {
          this.addWatchFile(
            fileURLToPath(new URL('../../packages/battle/dist/environment-build.json', import.meta.url)),
          )
          this.addWatchFile(fileURLToPath(new URL('./src/sandbox-effects.ts', import.meta.url)))
          await buildBaseSandboxArtifact(file => this.addWatchFile(file))
        }
      },
      async writeBundle() {
        if (this.meta.watchMode) await buildBaseEnvironmentArtifact()
      },
    },
  ],
  external: id => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0'),
})
