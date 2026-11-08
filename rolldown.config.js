import { defineConfig } from 'rolldown'
import { isBuiltin } from 'node:module'
import { fileURLToPath } from 'node:url'

// Keep network and server dependencies lazy in the bundled launcher.
const legacyDependencies = new Set([
  '@arcadia-eternity/database',
  '@arcadia-eternity/content-sdk/management-workspace',
  '@arcadia-eternity/content-sdk/managed-projects',
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
    'sandbox-node-worker': fileURLToPath(import.meta.resolve('@arcadia-eternity/battle/sandbox/node-worker')),
  },
  platform: 'node',
  output: {
    dir: 'dist',
    format: 'esm',
    banner:
      'import { createRequire as __arcadiaCreateRequire } from "node:module"; const require = __arcadiaCreateRequire(import.meta.url);',
  },
  tsconfig: true,
  external: id => isBuiltin(id) || legacyDependencies.has(id),
})
