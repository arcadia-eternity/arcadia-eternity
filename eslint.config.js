import globals from 'globals'
import pluginJs from '@eslint/js'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'

const root = import.meta.dirname

/** @type {import('eslint').Linter.Config[]} */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/test/**',
      '**/e2e/**',
      '**/__tests__/**',
      'tsconfig.json',
      '**/rolldown.config.*',
      '**/vitest.config.*',
      '**/*.d.ts',
      'scripts/**',
      'tools/**',
      'examples/**',
      'test-*.ts',
      'packages/*/index.ts',
      'packages/*/test/**',
      'packages/web-ui/**',
      'packages/p2p-transport/**',
      'packages/engine-plugins/**/index.ts',
      'packages/database/scripts/**',
      'packages/schema/examples/**',
      'packages/schema/script/**',
      'eslint.config.*',
    ],
  },
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: root,
      },
    },
    rules: {
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
)
