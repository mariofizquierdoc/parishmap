import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MultiPolygon } from 'geojson';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertValidBackup, createBackup, restoreBackup } from '../src/backup';
import { createPrismaClient } from '../src/db';
import { seedGuayaquil } from '../src/seed';
import { createTestDatabase } from './helpers/test-db';

const SHAPE: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [-79.9, -2.2],
        [-79.89, -2.2],
        [-79.89, -2.19],
        [-79.9, -2.2],
      ],
    ],
  ],
};

describe('backup and restore', () => {
  let db: ReturnType<typeof createTestDatabase>;
  let folder: string;
  const now = new Date('2026-11-05T15:30:45Z');

  beforeEach(async () => {
    db = createTestDatabase();
    folder = mkdtempSync(join(tmpdir(), "parish map's backup-"));

    const diocese = await seedGuayaquil(db.prisma);
    const vicariate = await db.prisma.vicariate.findFirstOrThrow();
    const parish = await db.prisma.parish.create({
      data: { dioceseId: diocese.id, vicariateId: vicariate.id, slug: 'p', name: 'P' },
    });
    await db.prisma.territory.create({
      data: { parishId: parish.id, draftGeojson: JSON.stringify(SHAPE), notes: 'nota' },
    });
  });

  afterEach(async () => {
    await db.cleanup();
    rmSync(folder, { recursive: true, force: true });
  });

  it('writes a valid database copy and readable GeoJSON, even if the path has a quote', async () => {
    const { databaseFile, geojsonFiles } = await createBackup(db.prisma, folder, now);
    expect(databaseFile).toContain('parishmap-20261105-153045.db');
    assertValidBackup(databaseFile);

    const geojson = JSON.parse(readFileSync(geojsonFiles[0]!, 'utf8'));
    expect(geojson.features[0].geometry).toEqual(SHAPE);
    expect(geojson.features[0].properties.notes).toBe('nota');
  });

  it('restores the data, and keeps the replaced database', async () => {
    const { databaseFile: backup } = await createBackup(db.prisma, folder, now);
    const liveFile = join(folder, 'live.db');
    writeFileSync(liveFile, 'current contents');

    const { previous } = restoreBackup(backup, liveFile, now);

    expect(readFileSync(previous!, 'utf8')).toBe('current contents');
    const restored = createPrismaClient(`file:${liveFile}`);
    try {
      const territory = await restored.territory.findFirstOrThrow();
      expect(JSON.parse(territory.draftGeojson!)).toEqual(SHAPE);
      expect(territory.notes).toBe('nota');
    } finally {
      await restored.$disconnect();
    }
  });

  it('restores when no database exists yet', async () => {
    const { databaseFile: backup } = await createBackup(db.prisma, folder, now);
    const { previous } = restoreBackup(backup, join(folder, 'new.db'), now);
    expect(previous).toBeNull();
    assertValidBackup(join(folder, 'new.db'));
  });

  it('refuses a bad backup and leaves the current database untouched', () => {
    const liveFile = join(folder, 'live.db');
    writeFileSync(liveFile, 'current contents');
    const before = readdirSync(folder);

    const notDatabase = join(folder, 'garbage.db');
    writeFileSync(notDatabase, 'this is not a database, just some text in a file');
    expect(() => restoreBackup(notDatabase, liveFile)).toThrow('Not a readable database');
    expect(() => restoreBackup(join(folder, 'missing.db'), liveFile)).toThrow('Backup not found');

    expect(readFileSync(liveFile, 'utf8')).toBe('current contents');
    expect(readdirSync(folder).sort()).toEqual([...before, 'garbage.db'].sort());
  });
});
