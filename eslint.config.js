import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

/** @type {import('typescript-eslint').ConfigArray} */
export default [
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  eslintConfigPrettier,
  {
    ignores: ['dist/**', 'node_modules/**', '**/*.js', '**/*.cjs', '**/*.mjs'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
];
