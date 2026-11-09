import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', 'server/src/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
