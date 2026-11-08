import { sharedConfig } from './eslint.config.js'

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.d.ts',
      '**/design/**',
      '**/rolldown.config.*',
      '**/vitest.config.*',
    ],
  },
  ...sharedConfig,
  {
    files: ['packages/server/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./packages/server/tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]
