import { availableParallelism } from 'node:os'
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { builtinEffectsPlugin } from '../../scripts/effect-module-plugin.ts'

export default defineConfig({
  plugins: [builtinEffectsPlugin()],
  resolve: {
    alias: [
      {
        find: '@arcadia-eternity/battle/v4/authoring',
        replacement: fileURLToPath(new URL('./v4-authoring.ts', import.meta.url)),
      },
      {
        find: '@arcadia-eternity/battle/v4/host',
        replacement: fileURLToPath(new URL('./v4-host.ts', import.meta.url)),
      },
      { find: '@arcadia-eternity/battle/v4', replacement: fileURLToPath(new URL('./v4.ts', import.meta.url)) },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/v4/**/*.test.ts'],
    pool: 'forks',
    // Keep singleton repositories, loggers and fake timers private to each file.
    isolate: true,
    fileParallelism: true,
    // Larger pools contend with the CPU-heavy turn regressions. Override via --maxWorkers when needed.
    maxWorkers: Math.min(2, availableParallelism()),
  },
})
