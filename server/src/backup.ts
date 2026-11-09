import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { PrismaClient } from './generated/prisma/client';
import { exportDiocese } from './territories';

function timestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

/**
 * Writes a consistent copy of the database, plus each diocese's shapes as GeoJSON.
 * The GeoJSON stays readable with any map tool, even without this application.
 */
export async function createBackup(prisma: PrismaClient, folder: string, now = new Date()) {
  mkdirSync(folder, { recursive: true });
  const stamp = timestamp(now);
  const databaseFile = join(folder, `parishmap-${stamp}.db`);

  // VACUUM INTO is safe while the server runs, unlike copying the file directly.
  await prisma.$executeRawUnsafe(`VACUUM INTO '${databaseFile.replace(/'/g, "''")}'`);

  const geojsonFiles: string[] = [];
  for (const diocese of await prisma.diocese.findMany()) {
    const file = join(folder, `${diocese.slug}-${stamp}.geojson`);
    writeFileSync(file, JSON.stringify(await exportDiocese(prisma, diocese.id), null, 1));
    geojsonFiles.push(file);
  }
  return { databaseFile, geojsonFiles };
}

/** Throws unless a file is an intact ParishMap database. */
export function assertValidBackup(file: string) {
  if (!existsSync(file)) throw new Error(`Backup not found: ${file}`);

  let database: Database.Database;
  try {
    database = new Database(file, { readonly: true, fileMustExist: true });
  } catch {
    throw new Error(`Not a readable database: ${file}`);
  }
  try {
    const { integrity_check: result } = database.prepare('PRAGMA integrity_check').get() as {
      integrity_check: string;
    };
    if (result !== 'ok') throw new Error(`Backup is damaged: ${result}`);
    const table = database
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Territory'`)
      .get();
    if (!table) throw new Error(`Not a ParishMap database: ${file}`);
  } catch (error) {
    if (error instanceof Error && /^(Backup is damaged|Not a ParishMap)/.test(error.message)) {
      throw error;
    }
    throw new Error(`Not a readable database: ${file}`, { cause: error });
  } finally {
    database.close();
  }
}

/**
 * Replaces the database with a backup. Stop the server first.
 * The current database is kept beside it, so a mistaken restore can be undone.
 */
export function restoreBackup(backupFile: string, databaseFile: string, now = new Date()) {
  assertValidBackup(backupFile);

  let previous: string | null = null;
  if (existsSync(databaseFile)) {
    previous = `${databaseFile}.before-restore-${timestamp(now)}`;
    renameSync(databaseFile, previous);
  }
  for (const suffix of ['-wal', '-shm', '-journal']) {
    rmSync(databaseFile + suffix, { force: true });
  }
  copyFileSync(backupFile, databaseFile);
  return { previous };
}
