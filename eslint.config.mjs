// @ts-check

import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig({
    ignores: ['dist/**', 'node_modules/**'],
    extends: [
        eslint.configs.recommended,
        tseslint.configs.strict,
        tseslint.configs.stylistic,
    ],
    // Overrides
    rules: {
        '@typescript-eslint/no-explicit-any': 'warn',
        '@/quotes': ['error', 'single', { 'allowTemplateLiterals': true }],
        // 'max-len': ['warn', { 'code': 120 }],
        'comma-dangle': ['error', 'always-multiline'],
        '@/semi': ['error'],
        'object-curly-spacing': ['error', 'always'],
        'eol-last': ['error', 'always'],
        'lines-between-class-members': ['error', 'always', { 'exceptAfterSingleLine': true }],
        '@typescript-eslint/explicit-function-return-type': 'off',
        '@typescript-eslint/no-parameter-properties': 'off',
        '@typescript-eslint/no-use-before-define': 'off',
        'max-classes-per-file': 'error',
        'prefer-template': 'error',
        '@typescript-eslint/camelcase': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
    },
});
