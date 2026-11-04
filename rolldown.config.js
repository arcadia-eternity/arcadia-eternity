import { defineConfig } from 'rolldown'
import { isBuiltin } from 'node:module'
import { fileURLToPath } from 'node:url'
import { builtinEffectsPlugin } from './scripts/effect-module-plugin.ts'

// Offline commands are self-contained. Existing network/server commands retain lazy service dependencies.
const legacyDependencies = new Set([
  '@arcadia-eternity/database',
  '@arcadia-eternity/content-dev/management-workspace',
  '@arcadia-eternity/content-dev/managed-projects',
  'dotenv',
  'dotenv/config',
  '@arcadia-eternity/client',
  '@arcadia-eternity/server',
  '@arcadia-eternity/p2p-transport',
  '@arcadia-eternity/p2p-transport/node',
  'rolldown',
])
export default defineConfig({
  input: {
    cli: 'bin/cli.ts',
    'v4-sandbox-node-worker': fileURLToPath(import.meta.resolve('@arcadia-eternity/battle/v4/sandbox/node-worker')),
  },
  platform: 'node',
  output: {
    dir: 'dist',
    format: 'esm',
    banner:
      'import { createRequire as __arcadiaCreateRequire } from "node:module"; const require = __arcadiaCreateRequire(import.meta.url);',
  },
  tsconfig: true,
  plugins: [builtinEffectsPlugin()],
  external: id => isBuiltin(id) || legacyDependencies.has(id),
})
