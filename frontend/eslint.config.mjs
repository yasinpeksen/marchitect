import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Same naming policy as the backend: descriptive, never single-letter, never abbreviated. */
const abbreviationPolicy = {
  checkFilenames: false,
  checkProperties: false,
  replacements: {
    cfg: { config: true }, msg: { message: true }, idx: { index: true }, tz: { timezone: true }, fn: { callback: true }, qs: { queryString: true },
    acct: { account: true }, conn: { connection: true }, conns: { connections: true },
    props: false, ref: false, refs: false, env: { environment: true },
  },
};

export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { unicorn, 'react-hooks': reactHooks, '@next/next': nextPlugin },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // correctness
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['error'] }],
      // readability / maintainability
      curly: ['error', 'multi-line'],
      complexity: ['error', 25],
      'max-depth': ['error', 4],
      'max-params': ['error', 6],
      'no-else-return': 'error',
      'no-lonely-if': 'error',
      'unicorn/no-nested-ternary': 'error',
      // naming
      'id-length': ['error', { min: 2, properties: 'never' }],
      'unicorn/prevent-abbreviations': ['error', abbreviationPolicy],
    },
  },
);
