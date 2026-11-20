import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

const unusedVars = [
  'error',
  { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
];

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'] },

  js.configs.recommended,

  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
    rules: { 'no-unused-vars': unusedVars },
  },

  {
    files: ['apps/web/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          // Context modules conventionally export their hook next to the provider;
          // App.jsx exports the route table for tests.
          allowExportNames: [
            'useAuth',
            'useWorkspace',
            'useOptionalWorkspace',
            'routes',
            'createRouter',
          ],
        },
      ],
      'no-unused-vars': unusedVars,
    },
  },

  {
    files: ['apps/web/vite.config.js'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['apps/web/public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },
];
