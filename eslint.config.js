import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import pluginVue from "eslint-plugin-vue";

const root = import.meta.dirname;

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ["**/dist/**", "**/test/**", "**/e2e/**", "**/__tests__/**", "tsconfig.json", "**/rollup.config.*", "**/vitest.config.*", "**/*.d.ts", "tools/**", "examples/**", "test-*.ts", "packages/*/index.ts", "packages/*/test/**"]
  },
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.ts", "*.mjs", "*.js", "*.d.ts"],
        },
        tsconfigRootDir: root,
      },
    },
    rules: {
      "@typescript-eslint/no-namespace": ["error", { "allowDeclarations": true }],
      "@typescript-eslint/no-unused-vars": ["error", {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_",
        "caughtErrorsIgnorePattern": "^_"
      }]
    }
  },
  ...pluginVue.configs["flat/essential"],
  {
    files: ["packages/web-ui/**/*.vue"],
    languageOptions: {
      parser: "vue-eslint-parser",
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        tsconfigRootDir: root,
        extraFileExtensions: [".vue"],
      },
    },
    rules: {
      "vue/multi-word-component-names": "off",
    },
  },
];