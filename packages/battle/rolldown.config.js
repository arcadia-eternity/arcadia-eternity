import { defineConfig } from 'rolldown'
import { buildEnvironmentArtifact } from '../../scripts/build-battle-environment.mjs'
export default defineConfig({
  input: {
    index: 'index.ts',
    pack: 'pack.ts',
    v4: 'v4.ts',
    'v4-authoring': 'v4-authoring.ts',
    'v4-host': 'v4-host.ts',
    'v4-sandbox': 'v4-sandbox.ts',
    'v4-sandbox-effects': 'v4-sandbox-effects.ts',
    'v4-sandbox-node': 'v4-sandbox-node.ts',
    'v4-sandbox-node-worker': 'src/v4-sandbox/node-worker.ts',
    'v4-sandbox-worker': 'src/v4-sandbox/browser-worker.ts',
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
