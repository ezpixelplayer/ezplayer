import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Flat-config port of the old .eslintrc.json; keeps epp's stricter
// type-checked promise rules, which the root config doesn't enable.
export default tseslint.config(
    { ignores: ['dist/'] },
    {
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['*.config.ts'],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-empty': 'off',
            'no-constant-condition': 'off',
            '@typescript-eslint/no-misused-promises': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            eqeqeq: ['error', 'always'],
            semi: ['error', 'always'],
            '@typescript-eslint/no-for-in-array': 'error',
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
);
