import { availableParallelism } from 'node:os'
import { defineConfig } from 'vitest/config'

export default defineConfig({
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
