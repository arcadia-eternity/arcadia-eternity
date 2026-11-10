import { effectDiscoveryPlugin } from '../pack-loader/src/npm/effect-discovery.ts'
import { availableParallelism } from 'node:os'
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { builtinEffectsPlugin } from '../../scripts/effect-module-plugin.ts'

export default defineConfig({
  plugins: [
    builtinEffectsPlugin(),
    effectDiscoveryPlugin(fileURLToPath(new URL('../../packs/base', import.meta.url)), ['src/effects'], true),
  ],
  resolve: {
    alias: [
      {
        find: '@arcadia-eternity/battle/authoring',
        replacement: fileURLToPath(new URL('./authoring.ts', import.meta.url)),
      },
      {
        find: '@arcadia-eternity/battle/host',
        replacement: fileURLToPath(new URL('./host.ts', import.meta.url)),
      },
      { find: '@arcadia-eternity/battle/engine', replacement: fileURLToPath(new URL('./engine.ts', import.meta.url)) },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    // Keep singleton repositories, loggers and fake timers private to each file.
    isolate: true,
    fileParallelism: true,
    // Larger pools contend with the CPU-heavy turn regressions. Override via --maxWorkers when needed.
    maxWorkers: Math.min(2, availableParallelism()),
  },
})
