import { defineConfig } from 'rolldown'
import { buildEnvironmentArtifact } from '../../scripts/build-battle-environment.mjs'
export default defineConfig({
  input: {
    index: 'index.ts',
    pack: 'pack.ts',
    v4: 'v4.ts',
    'v4-authoring': 'v4-authoring.ts',
    'v4-legacy': 'v4-legacy.ts',
    'v4-host': 'v4-host.ts',
  },
  output: { format: 'esm', dir: 'dist' },
  tsconfig: true,
  plugins: [
    {
      name: 'battle-watch-identity',
      async writeBundle() {
        if (this.meta.watchMode) await buildEnvironmentArtifact()
      },
    },
  ],
  external: id => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0'),
})
