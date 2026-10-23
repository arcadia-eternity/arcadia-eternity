import { defineConfig } from 'rolldown'
import { fileURLToPath } from 'node:url'
import { buildBaseEnvironmentArtifact } from '../../scripts/build-base-environment.mjs'

export default defineConfig({
  input: { native: 'native.ts' },
  output: { format: 'esm', dir: 'dist' },
  tsconfig: true,
  plugins: [
    {
      name: 'base-content-watch-identity',
      buildStart() {
        if (this.meta.watchMode)
          this.addWatchFile(
            fileURLToPath(new URL('../../packages/battle/dist/environment-build.json', import.meta.url)),
          )
      },
      async writeBundle() {
        if (this.meta.watchMode) await buildBaseEnvironmentArtifact()
      },
    },
  ],
  external: id => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0'),
})
