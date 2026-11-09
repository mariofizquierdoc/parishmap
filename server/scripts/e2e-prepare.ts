/**
 * Builds the throwaway database used by browser tests, with sample shapes.
 * It refuses to run on any other file, so sample shapes can't reach real data.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { MultiPolygon } from 'geojson';
import { resolveDatabaseUrl } from '../src/database-url';
import { createPrismaClient } from '../src/db';
import { applyImport } from '../src/importer/apply-import';
import { parseGuayaquilPage } from '../src/importer/parse-guayaquil';
import { GUAYAQUIL_SLUG, seedGuayaquil } from '../src/seed';

const url = resolveDatabaseUrl();
if (!url.endsWith('e2e.db')) {
  throw new Error(`Refusing to reset a database that isn't e2e.db: ${url}`);
}
const file = url.slice('file:'.length);

for (const suffix of ['', '-wal', '-shm', '-journal']) {
  if (existsSync(file + suffix)) rmSync(file + suffix);
}

const migrations = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
const sqlite = new Database(file);
for (const entry of readdirSync(migrations, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    sqlite.exec(readFileSync(`${migrations}/${entry.name}/migration.sql`, 'utf8'));
  }
}
sqlite.close();

function box(west: number, south: number, east: number, north: number): MultiPolygon {
  return {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    ],
  };
}

const prisma = createPrismaClient(url);
try {
  const diocese = await seedGuayaquil(prisma);
  const html = readFileSync(
    new URL('../test/fixtures/guayaquil-parroquias.html', import.meta.url),
    'utf8',
  );
  await applyImport(prisma, GUAYAQUIL_SLUG, parseGuayaquilPage(html));

  await prisma.territory.create({
    data: {
      dioceseId: diocese.id,
      publishedGeojson: JSON.stringify(box(-79.98, -2.26, -79.82, -2.1)),
      publishedAt: new Date('2026-10-01T12:00:00Z'),
    },
  });

  const publish = async (slug: string, shape: MultiPolygon, confidence: string) => {
    const parish = await prisma.parish.findFirstOrThrow({ where: { slug } });
    await prisma.territory.create({
      data: {
        parishId: parish.id,
        publishedGeojson: JSON.stringify(shape),
        publishedAt: new Date('2026-10-01T12:00:00Z'),
        confidence,
      },
    });
  };
  await publish('sagrada-familia', box(-79.92, -2.2, -79.9, -2.18), 'CONFIRMED');
  await publish('san-agustin', box(-79.9, -2.2, -79.88, -2.18), 'APPROXIMATE');
  await prisma.parish.update({
    where: { dioceseId_slug: { dioceseId: diocese.id, slug: 'san-agustin' } },
    data: { phone: '04-555-0100', website: 'https://example.org/san-agustin' },
  });

  const draft = await prisma.parish.findFirstOrThrow({ where: { slug: 'cristo-redentor' } });
  await prisma.territory.create({
    data: {
      parishId: draft.id,
      draftGeojson: JSON.stringify(box(-79.86, -2.2, -79.84, -2.18)),
      notes: 'SECRET-E2E-NOTE',
    },
  });

  await prisma.parish.update({
    where: { dioceseId_slug: { dioceseId: diocese.id, slug: 'iglesia-rectoral-san-jose' } },
    data: { hasTerritory: false },
  });

  console.log('E2E database ready.');
} finally {
  await prisma.$disconnect();
}
