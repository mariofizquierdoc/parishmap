import type { AdminDiocese, AdminProgress, AdminTerritory } from '@parishmap/shared/admin';
import type { MultiPolygon } from 'geojson';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { seedGuayaquil } from '../src/seed';
import { createTestAuth, TEST_PASSWORD, TEST_USERNAME } from './helpers/auth';
import { createTestDatabase } from './helpers/test-db';

const LNG = -79.9;
const LAT = -2.2;

function box(west: number, south: number, east: number, north: number): MultiPolygon {
  return {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [LNG + west, LAT + south],
          [LNG + east, LAT + south],
          [LNG + east, LAT + north],
          [LNG + west, LAT + north],
          [LNG + west, LAT + south],
        ],
      ],
    ].map((polygon) =>
      polygon.map((ring) =>
        ring.map(([lng, lat]) => [Math.round(lng! * 1e6) / 1e6, Math.round(lat! * 1e6) / 1e6]),
      ),
    ),
  };
}

const BOWTIE = {
  type: 'Polygon',
  coordinates: [
    [
      [LNG, LAT],
      [LNG + 0.01, LAT + 0.01],
      [LNG + 0.01, LAT],
      [LNG, LAT + 0.01],
      [LNG, LAT],
    ],
  ],
};

describe('admin territories', () => {
  let db: ReturnType<typeof createTestDatabase>;
  let agent: ReturnType<typeof request.agent>;
  let app: ReturnType<typeof createApp>;
  let dioceseId: number;
  let vicariateId: number;
  let a: number;
  let b: number;
  let noTerritory: number;

  const path = (id: number, suffix = '') => `/api/admin/territories/parish/${id}${suffix}`;
  const saveDraft = (id: number, geometry: unknown) =>
    agent.put(path(id, '/draft')).send({ geometry });
  const publicTerritories = async () =>
    (await request(app).get('/api/dioceses/guayaquil/territories').expect(200)).body as {
      features: { properties: { slug: string }; geometry: MultiPolygon }[];
    };

  beforeAll(async () => {
    db = createTestDatabase();
    app = createApp(db.prisma, {
      auth: createTestAuth(),
      admin: {
        maxLoginAttempts: 1000,
        satellite: {
          tileUrl: 'https://tiles.example/{z}/{x}/{y}?key=SECRET-KEY',
          attribution: 'X',
        },
      },
    });
    agent = request.agent(app);
    await agent
      .post('/api/admin/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
      .expect(200);

    const diocese = await seedGuayaquil(db.prisma);
    dioceseId = diocese.id;
    const vicariate = await db.prisma.vicariate.findFirstOrThrow({ where: { name: 'Centro' } });
    vicariateId = vicariate.id;
    const create = async (slug: string, hasTerritory = true) =>
      (
        await db.prisma.parish.create({
          data: { dioceseId, vicariateId, slug, name: slug.toUpperCase(), hasTerritory },
        })
      ).id;
    a = await create('a');
    b = await create('b');
    noTerritory = await create('rectoral', false);
  });

  afterAll(async () => {
    await db.cleanup();
  });

  beforeEach(async () => {
    await db.prisma.territoryVersion.deleteMany();
    await db.prisma.territory.deleteMany();
  });

  it('requires a session for every territory route', async () => {
    const anonymous = request(app);
    await anonymous.get(path(a)).expect(401);
    await anonymous
      .put(path(a, '/draft'))
      .send({ geometry: box(0, 0, 1, 1) })
      .expect(401);
    await anonymous.post(path(a, '/publish')).send({}).expect(401);
    await anonymous.get('/api/admin/dioceses/guayaquil/export').expect(401);
    await anonymous.get('/api/admin/config').expect(401);
  });

  it('serves the satellite setting only to logged-in admins', async () => {
    const res = await agent.get('/api/admin/config').expect(200);
    expect(res.body.satellite.tileUrl).toContain('SECRET-KEY');

    for (const route of ['/api/dioceses', '/api/dioceses/guayaquil']) {
      expect((await request(app).get(route)).text).not.toContain('SECRET-KEY');
    }
  });

  it('saves a draft without showing it publicly', async () => {
    const res = await saveDraft(a, box(0, 0, 0.01, 0.01)).expect(200);
    const body = res.body as AdminTerritory;
    expect(body.draft).toEqual(box(0, 0, 0.01, 0.01));
    expect(body.published).toBeNull();
    expect((await publicTerritories()).features).toEqual([]);
  });

  it('rounds and converts a submitted Polygon', async () => {
    const res = await saveDraft(a, {
      type: 'Polygon',
      coordinates: [
        [
          [LNG + 0.123456789, LAT],
          [LNG + 0.2, LAT],
          [LNG + 0.2, LAT + 0.1],
          [LNG + 0.123456789, LAT],
        ],
      ],
    }).expect(200);
    const body = res.body as AdminTerritory;
    expect(body.draft?.type).toBe('MultiPolygon');
    expect(body.draft?.coordinates[0]?.[0]?.[0]).toEqual([-79.776543, -2.2]);
  });

  it('rejects invalid shapes and saves nothing', async () => {
    const res = await saveDraft(a, BOWTIE).expect(422);
    expect(res.body).toEqual({ error: 'invalid-geometry', issues: ['self-intersection'] });

    await saveDraft(a, { type: 'Point', coordinates: [0, 0] }).expect(422);
    await saveDraft(a, undefined).expect(422);
    expect(await db.prisma.territory.count()).toBe(0);
  });

  it('rejects shapes for a church with no territory', async () => {
    const res = await saveDraft(noTerritory, box(0, 0, 0.01, 0.01)).expect(409);
    expect(res.body.error).toBe('no-territory');
  });

  it('returns 404 for unknown owners and malformed ids', async () => {
    await agent.get(path(99999)).expect(404);
    await agent.get('/api/admin/territories/parish/abc').expect(404);
    await agent.get('/api/admin/territories/other/1').expect(404);
  });

  it('reports overlaps with neighbors on save', async () => {
    await saveDraft(a, box(0, 0, 0.02, 0.02)).expect(200);
    const res = await saveDraft(b, box(0.01, 0, 0.03, 0.02)).expect(200);

    const { checks, neighbors } = res.body as AdminTerritory;
    expect(checks.overlaps.map((overlap) => overlap.name)).toEqual(['A']);
    expect(checks.overlaps[0]!.areaM2).toBeGreaterThan(1000);
    expect(neighbors.map((neighbor) => neighbor.name)).toEqual(['A']);
  });

  it('reports nothing for neighbors that only share an edge', async () => {
    await saveDraft(a, box(0, 0, 0.02, 0.02)).expect(200);
    const res = await saveDraft(b, box(0.02, 0, 0.04, 0.02)).expect(200);
    expect((res.body as AdminTerritory).checks.overlaps).toEqual([]);
  });

  it('reports the part outside the diocese', async () => {
    await agent
      .put(`/api/admin/territories/diocese/${dioceseId}/draft`)
      .send({ geometry: box(0, 0, 0.1, 0.1) })
      .expect(200);
    const res = await saveDraft(a, box(0.09, 0, 0.12, 0.01)).expect(200);
    const body = res.body as AdminTerritory;
    expect(body.outline).toEqual(box(0, 0, 0.1, 0.1));
    expect(body.checks.outside).not.toBeNull();
  });

  it('trims against neighbors without saving', async () => {
    await saveDraft(a, box(0, 0, 0.02, 0.02)).expect(200);
    const res = await agent
      .post(path(b, '/trim'))
      .send({ geometry: box(0.01, 0, 0.03, 0.02) })
      .expect(200);

    const check = await agent
      .post(path(b, '/check'))
      .send({ geometry: res.body.geometry })
      .expect(200);
    expect(check.body.overlaps).toEqual([]);
    expect(await db.prisma.territory.count({ where: { parishId: b } })).toBe(0);
  });

  it('reports when trimming would leave nothing', async () => {
    await saveDraft(a, box(0, 0, 0.02, 0.02)).expect(200);
    const res = await agent
      .post(path(b, '/trim'))
      .send({ geometry: box(0.005, 0.005, 0.01, 0.01) })
      .expect(422);
    expect(res.body.error).toBe('nothing-left-after-trim');
  });

  it('publishes a draft, and later drafts stay private until published again', async () => {
    await saveDraft(a, box(0, 0, 0.01, 0.01)).expect(200);
    const res = await agent.post(path(a, '/publish')).send({}).expect(200);
    const body = res.body as AdminTerritory;
    expect(body.published).toEqual(box(0, 0, 0.01, 0.01));
    expect(body.publishedAt).not.toBeNull();
    expect((await publicTerritories()).features[0]?.geometry).toEqual(box(0, 0, 0.01, 0.01));

    await saveDraft(a, box(0, 0, 0.02, 0.02)).expect(200);
    expect((await publicTerritories()).features[0]?.geometry).toEqual(box(0, 0, 0.01, 0.01));

    await agent.post(path(a, '/publish')).send({}).expect(200);
    expect((await publicTerritories()).features[0]?.geometry).toEqual(box(0, 0, 0.02, 0.02));
  });

  it('shows a publish immediately to a browser holding an older copy', async () => {
    const url = '/api/dioceses/guayaquil/parishes';
    const first = await request(app).get(url).expect(200);
    const etag = first.headers.etag as string;
    expect(etag).toBeDefined();

    // Nothing changed, so the browser's copy is still good.
    await request(app).get(url).set('If-None-Match', etag).expect(304);

    await saveDraft(a, box(0, 0, 0.01, 0.01)).expect(200);
    await agent.post(path(a, '/publish')).send({}).expect(200);

    const after = await request(app).get(url).set('If-None-Match', etag).expect(200);
    expect(after.text).toContain('"hasPublishedTerritory":true');
  });

  it('refuses to publish without a draft', async () => {
    const res = await agent.post(path(a, '/publish')).send({}).expect(409);
    expect(res.body.error).toBe('no-draft');
  });

  it('requires confirmation to publish with overlaps', async () => {
    await saveDraft(a, box(0, 0, 0.02, 0.02)).expect(200);
    await saveDraft(b, box(0.01, 0, 0.03, 0.02)).expect(200);

    const blocked = await agent.post(path(b, '/publish')).send({}).expect(409);
    expect(blocked.body.error).toBe('overlaps-need-confirmation');
    expect(blocked.body.overlaps[0].name).toBe('A');
    expect((await publicTerritories()).features).toEqual([]);

    await agent.post(path(b, '/publish')).send({ confirmOverlaps: true }).expect(200);
    expect((await publicTerritories()).features).toHaveLength(1);
  });

  it('refuses to publish a stored draft that became invalid', async () => {
    await db.prisma.territory.create({
      data: {
        parishId: a,
        draftGeojson: JSON.stringify({ type: 'MultiPolygon', coordinates: [BOWTIE.coordinates] }),
      },
    });
    const res = await agent.post(path(a, '/publish')).send({ confirmOverlaps: true }).expect(422);
    expect(res.body.issues).toEqual(['self-intersection']);
  });

  it('unpublishes while keeping the shape as a draft', async () => {
    await saveDraft(a, box(0, 0, 0.01, 0.01)).expect(200);
    await agent.post(path(a, '/publish')).send({}).expect(200);

    const res = await agent.post(path(a, '/unpublish')).send({}).expect(200);
    const body = res.body as AdminTerritory;
    expect(body.published).toBeNull();
    expect(body.draft).toEqual(box(0, 0, 0.01, 0.01));
    expect((await publicTerritories()).features).toEqual([]);

    await agent.post(path(a, '/unpublish')).send({}).expect(409);
  });

  it('records versions and restores one as a draft without changing the public site', async () => {
    await saveDraft(a, box(0, 0, 0.01, 0.01)).expect(200);
    await agent.post(path(a, '/publish')).send({}).expect(200);
    await saveDraft(a, box(0, 0, 0.02, 0.02)).expect(200);

    const versions = (await agent.get(path(a, '/versions')).expect(200)).body as {
      id: number;
      action: string;
    }[];
    expect(versions.map((version) => version.action)).toEqual(['SAVE', 'PUBLISH', 'SAVE']);

    const first = versions.at(-1)!;
    const res = await agent
      .post(path(a, `/versions/${first.id}/restore`))
      .send({})
      .expect(200);
    expect((res.body as AdminTerritory).draft).toEqual(box(0, 0, 0.01, 0.01));

    const after = (await agent.get(path(a, '/versions')).expect(200)).body as { action: string }[];
    expect(after[0]?.action).toBe('RESTORE');
    expect((await publicTerritories()).features[0]?.geometry).toEqual(box(0, 0, 0.01, 0.01));
  });

  it('refuses to restore a version belonging to another parish', async () => {
    await saveDraft(a, box(0, 0, 0.01, 0.01)).expect(200);
    const [version] = (await agent.get(path(a, '/versions')).expect(200)).body as { id: number }[];
    await agent
      .post(path(b, `/versions/${version!.id}/restore`))
      .send({})
      .expect(404);
  });

  it('imports GeoJSON as a draft and rejects bad files', async () => {
    const res = await agent
      .post(path(a, '/import'))
      .send({
        geojson: {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: box(0, 0, 0.01, 0.01) }],
        },
      })
      .expect(200);
    expect((res.body as AdminTerritory).draft).toEqual(box(0, 0, 0.01, 0.01));
    const versions = (await agent.get(path(a, '/versions'))).body as { action: string }[];
    expect(versions[0]?.action).toBe('IMPORT');

    await agent
      .post(path(b, '/import'))
      .send({ geojson: { type: 'Nope' } })
      .expect(422);
  });

  it('keeps notes private, and confidence reaches the public site', async () => {
    await saveDraft(a, box(0, 0, 0.01, 0.01)).expect(200);
    await agent.post(path(a, '/publish')).send({}).expect(200);
    const res = await agent
      .patch(path(a))
      .send({ confidence: 'CONFIRMED', notes: 'SECRET-N', sourceNotes: 'SECRET-S' })
      .expect(200);
    expect((res.body as AdminTerritory).notes).toBe('SECRET-N');

    const parishes = await request(app).get('/api/dioceses/guayaquil/parishes').expect(200);
    expect(parishes.text).toContain('"confidence":"CONFIRMED"');
    expect(parishes.text).not.toContain('SECRET-');

    await agent.patch(path(a)).send({ confidence: 'WRONG' }).expect(400);
    await agent.patch(path(a)).send({ other: 1 }).expect(400);
  });

  it('reports progress and coverage gaps', async () => {
    await agent
      .put(`/api/admin/territories/diocese/${dioceseId}/draft`)
      .send({ geometry: box(0, 0, 0.04, 0.02) })
      .expect(200);
    await saveDraft(a, box(0, 0, 0.02, 0.02)).expect(200);
    await agent.post(path(a, '/publish')).send({}).expect(200);
    await saveDraft(b, box(0.02, 0, 0.03, 0.02)).expect(200);

    const res = await agent.get('/api/admin/dioceses/guayaquil/progress').expect(200);
    const body = res.body as AdminProgress;
    expect(body).toMatchObject({
      total: 2,
      noTerritory: 1,
      published: 1,
      draftOnly: 1,
      notStarted: 0,
      outlineDrawn: true,
    });
    expect(body.gaps?.coordinates).toHaveLength(1);
    expect(body.shapes).toHaveLength(2);
  });

  it('updates parish details, validates them, and keeps the slug', async () => {
    const res = await agent
      .patch(`/api/admin/parishes/${a}`)
      .send({ name: 'Corregida', phone: ' 04-111 ', address: '', website: 'https://x.example' });
    expect(res.status).toBe(200);

    const parish = await db.prisma.parish.findUniqueOrThrow({ where: { id: a } });
    expect(parish).toMatchObject({
      name: 'Corregida',
      slug: 'a',
      phone: '04-111',
      address: null,
      website: 'https://x.example',
    });
    await db.prisma.parish.update({ where: { id: a }, data: { name: 'A' } });

    const patch = (body: object) => agent.patch(`/api/admin/parishes/${a}`).send(body);
    await patch({ website: 'javascript:alert(1)' }).expect(400);
    await patch({ name: '' }).expect(400);
    await patch({ slug: 'hacked' }).expect(400);
    await patch({ vicariateId: 99999 }).expect(422);
    await agent.patch('/api/admin/parishes/99999').send({ name: 'x' }).expect(404);
  });

  it('lists parishes with their mapping status', async () => {
    await saveDraft(a, box(0, 0, 0.01, 0.01)).expect(200);
    await agent.post(path(a, '/publish')).send({}).expect(200);
    await saveDraft(b, box(0.02, 0, 0.03, 0.01)).expect(200);

    const res = await agent.get('/api/admin/dioceses/guayaquil').expect(200);
    const { parishes } = res.body as AdminDiocese;
    const find = (id: number) => parishes.find((parish) => parish.id === id)!;
    expect(find(a)).toMatchObject({
      hasDraft: true,
      hasPublished: true,
      hasUnpublishedChanges: false,
    });
    expect(find(b)).toMatchObject({
      hasDraft: true,
      hasPublished: false,
      hasUnpublishedChanges: true,
    });
    expect(find(noTerritory)).toMatchObject({ hasDraft: false, hasTerritory: false });
  });

  it('exports shapes and notes, for one parish or all', async () => {
    await saveDraft(a, box(0, 0, 0.01, 0.01)).expect(200);
    await agent.patch(path(a)).send({ notes: 'nota' }).expect(200);
    await saveDraft(b, box(0.02, 0, 0.03, 0.01)).expect(200);

    const all = await agent.get('/api/admin/dioceses/guayaquil/export').expect(200);
    expect(all.headers['content-disposition']).toContain('guayaquil.geojson');
    expect(all.body.features).toHaveLength(2);
    expect(all.body.features[0].properties).toMatchObject({
      slug: 'a',
      state: 'draft',
      notes: 'nota',
    });

    const one = await agent.get(`/api/admin/dioceses/guayaquil/export?parish=${b}`).expect(200);
    expect(
      one.body.features.map((f: { properties: { slug: string } }) => f.properties.slug),
    ).toEqual(['b']);
  });
});
