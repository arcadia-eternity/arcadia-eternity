import { defineConfig } from 'rolldown'
import { isExternalDependency } from '../../scripts/rollup-external.mjs'
import { buildEnvironmentArtifact } from '../../scripts/build-battle-environment.mjs'
export default defineConfig({
  input: {
    index: 'index.ts',
    pack: 'pack.ts',
    engine: 'engine.ts',
    authoring: 'authoring.ts',
    host: 'host.ts',
    sandbox: 'sandbox.ts',
    'sandbox-effects': 'sandbox-effects.ts',
    'sandbox-node': 'sandbox-node.ts',
    'sandbox-node-worker': 'src/sandbox/node-worker.ts',
    'sandbox-worker': 'src/sandbox/browser-worker.ts',
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
  external: isExternalDependency,
})
