import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';
import { resolveDatabaseUrl } from './src/database-url';

// Unlike the dev server, the Prisma CLI doesn't load .env by itself.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx --env-file-if-exists=.env prisma/seed.ts',
  },
  datasource: {
    url: resolveDatabaseUrl(),
  },
});
