import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{shared,server,web}/{src,test}/**/*.test.{ts,tsx}'],
  },
});
