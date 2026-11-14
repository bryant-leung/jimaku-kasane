// Lint for the extension, the e2e specs and the build scripts: `npm run lint`.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      'extension/dist/**',
      'extension/.wxt/**',
      'extension/.output/**',
      'extension/public/**',
      'data/**',
      'graphify-out/**',
      'playwright-report/**',
      'test-results/**',
      'server/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `{ id: _id, ...rest }` names a field only to leave it out of `rest`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // tokenizer.ts pulls in its hand-written kuromoji types with a path reference.
      '@typescript-eslint/triple-slash-reference': ['error', { path: 'always' }],
    },
  },
  {
    files: ['extension/src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
  },
  {
    files: ['e2e/**/*.ts', 'e2e/**/*.mjs', 'scripts/**/*.mjs', '*.config.ts', '*.config.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
