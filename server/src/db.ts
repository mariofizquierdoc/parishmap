import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { resolveDatabaseUrl } from './database-url';
import { PrismaClient } from './generated/prisma/client';

export function createPrismaClient(url = resolveDatabaseUrl()): PrismaClient {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}
