import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Czech bank exports use non-breaking spaces as thousands separators —
      // these parsers match them on purpose (see lib/parsers/csv/numbers.ts).
      'no-irregular-whitespace': 'off',
    },
  },
  globalIgnores(['dist/**', 'src/lib/generated/**']),
]);
