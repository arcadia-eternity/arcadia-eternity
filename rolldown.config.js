import { defineConfig } from 'rolldown'
import { isBuiltin } from 'node:module'

// Offline commands are self-contained. Existing network/server commands retain lazy service dependencies.
const legacyDependencies = new Set([
  'dotenv',
  '@arcadia-eternity/client',
  '@arcadia-eternity/server',
  '@arcadia-eternity/rules',
  '@arcadia-eternity/p2p-transport',
  '@arcadia-eternity/p2p-transport/node',
])
export default defineConfig({
  input: 'bin/cli.ts',
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
