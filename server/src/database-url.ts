import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_URL = 'file:./data/parishmap.db';

/**
 * Returns DATABASE_URL with an absolute file path, creating its folder if needed.
 *
 * The Prisma CLI and the runtime adapter can run from different working directories.
 * Anchoring relative paths to server/ ensures both always open the same file.
 */
export function resolveDatabaseUrl(rawUrl = process.env.DATABASE_URL ?? DEFAULT_URL): string {
  if (!rawUrl.startsWith('file:')) {
    throw new Error('DATABASE_URL must be a SQLite "file:" URL');
  }
  const path = rawUrl.slice('file:'.length);
  const absolutePath = isAbsolute(path) ? path : resolve(SERVER_ROOT, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  return `file:${absolutePath}`;
}
