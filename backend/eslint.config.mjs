import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';

/** Domain terms that stay as written (real names of the thing, not shortenings). */
const abbreviationPolicy = {
  checkFilenames: false,
  checkProperties: false,
  replacements: {
    // our own recurring shortenings
    sb: { supabase: true }, cfg: { config: true }, acct: { account: true }, conn: { connection: true },
    conns: { connections: true }, msg: { message: true }, idx: { index: true }, cr: { creative: true },
    bd: { breakdown: true }, kw: { keyword: true }, tz: { timezone: true }, fn: { callback: true },
    qs: { queryString: true }, ins: { insights: true }, num: { toNumber: true },
    // dictionary entries we deliberately keep as the real name
    props: false, ref: false, refs: false, docs: false, doc: false, dev: false, env: { environment: true },
  },
};

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { unicorn },
    rules: {
      // correctness
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['error', 'log'] }],
      // readability / maintainability
      curly: ['error', 'multi-line'],
      complexity: ['error', 25],
      'max-depth': ['error', 4],
      'max-params': ['error', 6],
      'no-else-return': 'error',
      'no-lonely-if': 'error',
      'unicorn/no-nested-ternary': 'error',
      // naming: descriptive, never single-letter, never abbreviated
      'id-length': ['error', { min: 2, properties: 'never' }],
      'unicorn/prevent-abbreviations': ['error', abbreviationPolicy],
    },
  },
);
