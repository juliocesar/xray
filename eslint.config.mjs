import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import pluginPrettier from 'eslint-plugin-prettier'
import turboPlugin from 'eslint-plugin-turbo'
import tseslint from 'typescript-eslint'
import onlyWarn from 'eslint-plugin-only-warn'

/**
 * Shared flat config for the whole workspace. Rules mirror cecco's
 * `@cecco/eslint-config/base`. With only two product packages there is no shared
 * config package; each package re-exports this from its own `eslint.config.mjs`.
 */
export default [
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    plugins: {
      turbo: turboPlugin,
      prettier: pluginPrettier,
      onlyWarn,
    },
    rules: {
      // xray reads XRAY_* env vars as intentional runtime config, not Turbo inputs.
      'turbo/no-undeclared-env-vars': 'off',
      'prettier/prettier': 'error',
    },
  },
  {
    ignores: ['dist/**', '**/dist/**', '**/templates/**'],
  },
]
