import type { PublicParish, PublicParishList } from '@parishmap/shared';
import type { MultiPolygon } from 'geojson';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { seedGuayaquil } from '../src/seed';
import { createTestDatabase } from './helpers/test-db';

const SECRET_NOTE = 'SECRET-PRIVATE-NOTE';
const SECRET_SOURCE = 'SECRET-SOURCE-NOTE';

function box(west: number, south: number): MultiPolygon {
  const [east, north] = [west + 0.01, south + 0.01];
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

const PUBLISHED = box(-79.9, -2.2);
const DRAFT = box(-79.5, -2.5);
const PUBLISHED_AT = new Date('2026-10-01T12:00:00.000Z');

describe('public API', () => {
  let db: ReturnType<typeof createTestDatabase>;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    db = createTestDatabase();
    app = createApp(db.prisma);

    const diocese = await seedGuayaquil(db.prisma);
    const centro = await db.prisma.vicariate.findFirstOrThrow({ where: { name: 'Centro' } });
    const sur = await db.prisma.vicariate.findFirstOrThrow({ where: { name: 'Sur' } });

    const parish = (vicariateId: number, slug: string, name: string, extra = {}) =>
      db.prisma.parish.create({
        data: { dioceseId: diocese.id, vicariateId, slug, name, ...extra },
      });

    const mapped = await parish(centro.id, 'mapeada', 'Mapeada', {
      phone: '04-000-0000',
    });
    const draftOnly = await parish(centro.id, 'borrador', 'Ángel Borrador');
    const hidden = await parish(centro.id, 'oculta', 'Oculta', { isPublished: false });
    const rectoral = await parish(sur.id, 'rectoral', 'Iglesia Rectoral', {
      hasTerritory: false,
    });
    await parish(sur.id, 'sin-area', 'Sin Área');

    const territory = (parishId: number, extra: object) =>
      db.prisma.territory.create({
        data: { parishId, notes: SECRET_NOTE, sourceNotes: SECRET_SOURCE, ...extra },
      });
    const published = {
      publishedGeojson: JSON.stringify(PUBLISHED),
      publishedAt: PUBLISHED_AT,
    };

    await territory(mapped.id, {
      ...published,
      draftGeojson: JSON.stringify(DRAFT),
      confidence: 'CONFIRMED',
    });
    await territory(draftOnly.id, { draftGeojson: JSON.stringify(DRAFT) });
    await territory(hidden.id, published);
    await territory(rectoral.id, published);

    await db.prisma.territory.create({
      data: {
        dioceseId: diocese.id,
        publishedGeojson: JSON.stringify(PUBLISHED),
        draftGeojson: JSON.stringify(DRAFT),
        notes: SECRET_NOTE,
        sourceNotes: SECRET_SOURCE,
      },
    });
  });

  afterAll(async () => {
    await db.cleanup();
  });

  async function allParishes(): Promise<PublicParish[]> {
    const res = await request(app).get('/api/dioceses/guayaquil/parishes').expect(200);
    return (res.body as PublicParishList).vicariates.flatMap((v) => v.parishes);
  }

  it('lists dioceses', async () => {
    const res = await request(app).get('/api/dioceses').expect(200);
    expect(res.body).toEqual([{ slug: 'guayaquil', name: 'Arquidiócesis de Guayaquil' }]);
  });

  it('returns a diocese with its published outline only', async () => {
    const res = await request(app).get('/api/dioceses/guayaquil').expect(200);
    expect(res.body.outline).toEqual(PUBLISHED);
    expect(Object.keys(res.body).sort()).toEqual(['name', 'outline', 'slug', 'sourceUrl']);
  });

  it('returns 404 for unknown dioceses on every route', async () => {
    await request(app).get('/api/dioceses/nope').expect(404);
    await request(app).get('/api/dioceses/nope/parishes').expect(404);
    await request(app).get('/api/dioceses/nope/territories').expect(404);
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(app).get('/api/unknown').expect(404);
    expect(res.body).toEqual({ error: 'not-found' });
  });

  it('groups parishes by vicariate, in source order, sorted with Spanish rules', async () => {
    const res = await request(app).get('/api/dioceses/guayaquil/parishes').expect(200);
    const { vicariates } = res.body as PublicParishList;
    expect(vicariates.map((v) => v.name)).toEqual([
      'Centro',
      'Noroeste',
      'Norte',
      'Sur',
      'Suroeste',
      'Vía a la Costa',
      'Vía a Daule',
    ]);
    // "Ángel" sorts before "Mapeada", not after Z as a plain comparison would place it.
    expect(vicariates[0]!.parishes.map((p) => p.slug)).toEqual(['borrador', 'mapeada']);
  });

  it('describes a published parish and its optional fields', async () => {
    const parish = (await allParishes()).find((p) => p.slug === 'mapeada');
    expect(parish).toEqual({
      slug: 'mapeada',
      name: 'Mapeada',
      vicariate: 'Centro',
      hasTerritory: true,
      hasPublishedTerritory: true,
      confidence: 'CONFIRMED',
      territoryUpdatedAt: PUBLISHED_AT.toISOString(),
      address: null,
      phone: '04-000-0000',
      email: null,
      website: null,
      priest: null,
    });
  });

  it('shows draft-only and unmapped parishes without a territory', async () => {
    const parishes = await allParishes();
    for (const slug of ['borrador', 'sin-area']) {
      const parish = parishes.find((p) => p.slug === slug);
      expect(parish?.hasPublishedTerritory).toBe(false);
      expect(parish?.confidence).toBeNull();
      expect(parish?.territoryUpdatedAt).toBeNull();
    }
  });

  it('never shows a territory for a church marked as having none', async () => {
    const parish = (await allParishes()).find((p) => p.slug === 'rectoral');
    expect(parish?.hasTerritory).toBe(false);
    expect(parish?.hasPublishedTerritory).toBe(false);

    const res = await request(app).get('/api/dioceses/guayaquil/territories').expect(200);
    const slugs = res.body.features.map((f: { properties: { slug: string } }) => f.properties.slug);
    expect(slugs).not.toContain('rectoral');
  });

  it('hides unpublished parishes everywhere', async () => {
    expect((await allParishes()).map((p) => p.slug)).not.toContain('oculta');
    const res = await request(app).get('/api/dioceses/guayaquil/territories').expect(200);
    expect(JSON.stringify(res.body)).not.toContain('oculta');
  });

  it('returns only published shapes as GeoJSON, with no draft geometry', async () => {
    const res = await request(app).get('/api/dioceses/guayaquil/territories').expect(200);
    expect(res.body).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: PUBLISHED,
          properties: { slug: 'mapeada', name: 'Mapeada', confidence: 'CONFIRMED' },
        },
      ],
    });
  });

  it('never exposes notes or drafts on any public route', async () => {
    const draftCoordinate = String(DRAFT.coordinates[0]![0]![0]![0]);
    for (const path of [
      '/api/dioceses',
      '/api/dioceses/guayaquil',
      '/api/dioceses/guayaquil/parishes',
      '/api/dioceses/guayaquil/territories',
    ]) {
      const res = await request(app).get(path).expect(200);
      expect(res.text).not.toContain(SECRET_NOTE);
      expect(res.text).not.toContain(SECRET_SOURCE);
      expect(res.text).not.toContain(draftCoordinate);
      expect(res.text).not.toMatch(/draftGeojson|sourceNotes|"notes"/);
    }
  });

  it('sets cache and security headers', async () => {
    const res = await request(app).get('/api/dioceses').expect(200);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
