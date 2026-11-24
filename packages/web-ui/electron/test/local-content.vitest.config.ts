import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['electron/test/local-content-sessions.spec.ts'], environment: 'node', maxWorkers: 1 },
})
