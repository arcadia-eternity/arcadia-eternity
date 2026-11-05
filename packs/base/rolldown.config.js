import { defineConfig } from 'rolldown'
import { isExternalDependency } from '../../scripts/rollup-external.mjs'
import { fileURLToPath } from 'node:url'
import { buildBaseEnvironmentArtifact } from '../../scripts/build-base-environment.mjs'

export default defineConfig({
  input: { effects: 'effects.ts' },
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
        }
      },
      async writeBundle() {
        if (this.meta.watchMode) await buildBaseEnvironmentArtifact()
      },
    },
  ],
  external: isExternalDependency,
})
