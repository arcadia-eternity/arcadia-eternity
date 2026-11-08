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
    files: ['packages/battle/**/*.ts', 'packs/base/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./packages/battle/tsconfig.test.json', './packs/base/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]
