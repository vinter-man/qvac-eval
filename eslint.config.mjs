import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { noComments } from './tooling/eslint/no-comments.mjs';

export default defineConfig([
  globalIgnores(['dist/', 'coverage/', 'reports/', 'site/', '.qvac-eval/', 'docs/remotion/']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    linterOptions: { noInlineConfig: true },
    plugins: { local: { rules: { 'no-comments': noComments } } },
    rules: {
      'local/no-comments': 'error',
      'no-console': 'error',
    },
  },
]);
