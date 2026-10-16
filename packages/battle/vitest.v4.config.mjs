import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', include: ['test/v4/**/*.test.ts'], maxWorkers: 2 } })
