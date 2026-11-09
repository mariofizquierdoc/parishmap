import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createPrismaClient } from '../../src/db';

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../../prisma/migrations');

/** Creates a throwaway database with all migrations applied. Never touches the dev database. */
export function createTestDatabase() {
  const folder = mkdtempSync(join(tmpdir(), 'parishmap-test-'));
  const file = join(folder, 'test.db');

  const sqlite = new Database(file);
  for (const entry of readdirSync(MIGRATIONS, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      sqlite.exec(readFileSync(join(MIGRATIONS, entry.name, 'migration.sql'), 'utf8'));
    }
  }
  sqlite.close();

  const prisma = createPrismaClient(`file:${file}`);
  return {
    prisma,
    async cleanup() {
      await prisma.$disconnect();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}
