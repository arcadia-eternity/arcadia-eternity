import globals from 'globals'
import pluginJs from '@eslint/js'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'

const root = import.meta.dirname

/** @type {import('eslint').Linter.Config[]} */
export const sharedConfig = tseslint.config(
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
      '@typescript-eslint/no-base-to-string': [
        'error',
        {
          checkUnknown: true,
        },
      ],
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
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['.pnpmfile.cjs', 'packages/content-dev/**/*.mjs'],
  },
  // The engine retains its existing rule exceptions; host, sandbox and tests use the shared rules.
  {
    files: ['packages/battle/src/engine/**/*.ts'],
    ignores: [
      'packages/battle/src/engine/api.ts',
      'packages/battle/src/engine/reactiveValue.ts',
      'packages/battle/src/engine/rng.ts',
      'packages/battle/src/engine/snapshot.ts',
      'packages/battle/src/engine/snapshotBindings.ts',
    ],
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-case-declarations': 'off',
      'prefer-const': 'off',
      'preserve-caught-error': 'off',
      'no-useless-escape': 'off',
      'no-useless-assignment': 'off',
    },
  },
)

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
      '**/vitest.*.config.*',
      '**/*.d.{ts,mts,cts}',
      'scripts/**',
      'tools/**',
      'examples/**',
      'test-*.ts',
      'packages/*/index.ts',
      'packages/*/test/**',
      'packages/web-ui/**',
      'packages/engine-plugins/**/index.ts',
      'packages/database/scripts/**',
      'packages/schema/examples/**',
      'packages/schema/script/**',
      'eslint.config.*',
    ],
  },
  ...sharedConfig,
)
