import js from '@eslint/js';
import ts from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'dist-site/**', '**/*.local/**', '**/*.local', 'test-results/**', 'playwright-report/**', '.npm-cache/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { files: ['**/*.{js,mjs,ts,tsx}'], rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }] }, languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  { files: ['src/**/*.{ts,tsx}'], plugins: { 'react-hooks': reactHooks }, rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'error',
  } },
];
