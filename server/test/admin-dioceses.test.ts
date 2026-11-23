import type { AdminDiocese, AdminDioceseSummary } from '@parishmap/shared/admin';
import type { MultiPolygon } from 'geojson';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pickParishSlug } from '../src/catalog';
import { createApp } from '../src/app';
import { seedGuayaquil } from '../src/seed';
import { createTestAuth, TEST_PASSWORD, TEST_USERNAME } from './helpers/auth';
import { createTestDatabase } from './helpers/test-db';

const SQUARE: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [-79.9, -2.2],
        [-79.89, -2.2],
        [-79.89, -2.19],
        [-79.9, -2.19],
        [-79.9, -2.2],
      ],
    ],
  ],
};

describe('admin dioceses, vicariates and parishes', () => {
  let db: ReturnType<typeof createTestDatabase>;
  let app: ReturnType<typeof createApp>;
  let agent: ReturnType<typeof request.agent>;
  let guayaquilId: number;

  const createDiocese = (body: object) => agent.post('/api/admin/dioceses').send(body);
  const adminDiocese = async (slug: string) =>
    (await agent.get(`/api/admin/dioceses/${slug}`).expect(200)).body as AdminDiocese;

  /** A fresh diocese with one vicariate, so tests don't depend on each other. */
  async function setUp(slug: string) {
    const { id } = (await createDiocese({ name: `Diócesis ${slug}`, slug }).expect(201)).body as {
      id: number;
    };
    const vicariate = (
      await agent.post(`/api/admin/dioceses/${id}/vicariates`).send({ name: 'Centro' }).expect(201)
    ).body as { id: number };
    return { id, vicariateId: vicariate.id, name: `Diócesis ${slug}` };
  }

  beforeAll(async () => {
    db = createTestDatabase();
    app = createApp(db.prisma, { auth: createTestAuth(), admin: { maxLoginAttempts: 1000 } });
    agent = request.agent(app);
    await agent
      .post('/api/admin/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
      .expect(200);
    guayaquilId = (await seedGuayaquil(db.prisma)).id;
  });

  afterAll(async () => {
    await db.cleanup();
  });

  it('requires a session for every new route', async () => {
    const anonymous = request(app);
    await anonymous.get('/api/admin/dioceses').expect(401);
    await anonymous.post('/api/admin/dioceses').send({ name: 'X', slug: 'x' }).expect(401);
    await anonymous.patch(`/api/admin/dioceses/${guayaquilId}`).send({ name: 'X' }).expect(401);
    await anonymous
      .delete(`/api/admin/dioceses/${guayaquilId}`)
      .send({ confirmName: 'X' })
      .expect(401);
    await anonymous
      .post(`/api/admin/dioceses/${guayaquilId}/vicariates`)
      .send({ name: 'X' })
      .expect(401);
    await anonymous
      .put(`/api/admin/dioceses/${guayaquilId}/vicariates/order`)
      .send({ ids: [] })
      .expect(401);
    await anonymous.patch('/api/admin/vicariates/1').send({ name: 'X' }).expect(401);
    await anonymous.delete('/api/admin/vicariates/1').send({}).expect(401);
    await anonymous.post(`/api/admin/dioceses/${guayaquilId}/parishes`).send({}).expect(401);
    await anonymous.delete('/api/admin/parishes/1').send({ confirmName: 'X' }).expect(401);
  });

  it('creates a diocese that starts hidden from the public site', async () => {
    const res = await createDiocese({
      name: 'Diócesis de Prueba',
      slug: 'prueba',
      sourceUrl: 'https://example.org/parroquias',
    }).expect(201);
    expect(res.body).toMatchObject({ slug: 'prueba' });

    const list = (await agent.get('/api/admin/dioceses').expect(200)).body as AdminDioceseSummary[];
    expect(list.find((d) => d.slug === 'prueba')).toMatchObject({
      name: 'Diócesis de Prueba',
      sourceUrl: 'https://example.org/parroquias',
      isPublished: false,
      parishCount: 0,
      vicariateCount: 0,
      outlineDrawn: false,
    });
    expect(list.find((d) => d.slug === 'guayaquil')).toMatchObject({ isPublished: true });

    const publicList = (await request(app).get('/api/dioceses').expect(200)).body as {
      slug: string;
    }[];
    expect(publicList.map((d) => d.slug)).toEqual(['guayaquil']);
    for (const suffix of ['', '/parishes', '/territories']) {
      await request(app).get(`/api/dioceses/prueba${suffix}`).expect(404);
    }

    await agent.patch(`/api/admin/dioceses/${res.body.id}`).send({ isPublished: true }).expect(200);
    await request(app).get('/api/dioceses/prueba').expect(200);
  });

  it('rejects bad, reserved and taken slugs', async () => {
    const error = async (slug: string, status: number) =>
      (await createDiocese({ name: 'X', slug }).expect(status)).body.error as string;
    expect(await error('Con Espacios', 422)).toBe('invalid-slug');
    expect(await error('-guion', 422)).toBe('invalid-slug');
    expect(await error('', 422)).toBe('invalid-slug');
    expect(await error('x'.repeat(61), 422)).toBe('invalid-slug');
    expect(await error('admin', 422)).toBe('slug-reserved');
    expect(await error('api', 422)).toBe('slug-reserved');
    expect(await error('guayaquil', 409)).toBe('slug-taken');
    await createDiocese({ name: '', slug: 'vacia' }).expect(400);
    await createDiocese({ name: 'X', slug: 'url', sourceUrl: 'ftp://x' }).expect(400);
  });

  it('never changes a slug after creation', async () => {
    await agent.patch(`/api/admin/dioceses/${guayaquilId}`).send({ slug: 'otra' }).expect(400);
    await agent
      .patch(`/api/admin/dioceses/${guayaquilId}`)
      .send({ name: 'Arquidiócesis de Guayaquil (editada)', sourceUrl: '' })
      .expect(200);
    const diocese = await adminDiocese('guayaquil');
    expect(diocese).toMatchObject({
      slug: 'guayaquil',
      name: 'Arquidiócesis de Guayaquil (editada)',
      sourceUrl: null,
    });
    await agent.patch('/api/admin/dioceses/99999').send({ name: 'X' }).expect(404);
  });

  it('adds, renames, reorders and deletes vicariates', async () => {
    const { id, vicariateId: centro } = await setUp('vicarias');
    const add = async (name: string) =>
      (await agent.post(`/api/admin/dioceses/${id}/vicariates`).send({ name }).expect(201)).body
        .id as number;
    const norte = await add('Norte');
    const sur = await add('Sur');

    const duplicate = await agent
      .post(`/api/admin/dioceses/${id}/vicariates`)
      .send({ name: 'Norte' })
      .expect(409);
    expect(duplicate.body.error).toBe('vicariate-exists');
    expect(
      (await agent.patch(`/api/admin/vicariates/${sur}`).send({ name: 'Norte' }).expect(409)).body
        .error,
    ).toBe('vicariate-exists');
    await agent.patch(`/api/admin/vicariates/${sur}`).send({ name: 'Sur Este' }).expect(200);

    const order = `/api/admin/dioceses/${id}/vicariates/order`;
    await agent
      .put(order)
      .send({ ids: [sur, norte, centro] })
      .expect(200);
    expect((await adminDiocese('vicarias')).vicariates.map((v) => v.name)).toEqual([
      'Sur Este',
      'Norte',
      'Centro',
    ]);
    for (const ids of [
      [sur, norte],
      [sur, norte, centro, centro],
      [sur, norte, 99999],
    ]) {
      expect((await agent.put(order).send({ ids }).expect(422)).body.error).toBe('invalid-order');
    }
    // Vicariates of another diocese can't be slipped into the order.
    const guayaquil = await adminDiocese('guayaquil');
    await agent
      .put(order)
      .send({ ids: [sur, norte, guayaquil.vicariates[0]!.id] })
      .expect(422);

    await agent
      .post(`/api/admin/dioceses/${id}/parishes`)
      .send({ name: 'San José', vicariateId: norte })
      .expect(201);
    expect((await adminDiocese('vicarias')).vicariates.find((v) => v.id === norte)).toMatchObject({
      parishCount: 1,
    });
    expect(
      (await agent.delete(`/api/admin/vicariates/${norte}`).send({}).expect(409)).body.error,
    ).toBe('vicariate-not-empty');
    await agent.delete(`/api/admin/vicariates/${sur}`).expect(400);
    await agent.delete(`/api/admin/vicariates/${sur}`).send({}).expect(200);
    await agent.delete(`/api/admin/vicariates/${sur}`).send({}).expect(404);
  });

  it('creates parishes with unique slugs', async () => {
    const { id, vicariateId } = await setUp('parroquias');
    const create = (body: object) => agent.post(`/api/admin/dioceses/${id}/parishes`).send(body);

    const first = await create({ name: 'Jesús Obrero', vicariateId, phone: '' }).expect(201);
    expect(first.body.slug).toBe('jesus-obrero');
    expect((await create({ name: 'Jesús Obrero', vicariateId }).expect(201)).body.slug).toBe(
      'jesus-obrero-centro',
    );
    expect((await create({ name: 'Jesús Obrero', vicariateId }).expect(201)).body.slug).toBe(
      'jesus-obrero-2',
    );
    expect(
      (await create({ name: 'Otra', vicariateId, slug: 'jesus-obrero' }).expect(409)).body.error,
    ).toBe('slug-taken');
    expect(
      (await create({ name: 'Otra', vicariateId, slug: 'Mal Slug' }).expect(422)).body.error,
    ).toBe('invalid-slug');
    expect(
      (await create({ name: 'Otra', vicariateId, slug: 'la-otra', isPublished: false }).expect(201))
        .body.slug,
    ).toBe('la-otra');

    const parish = (await adminDiocese('parroquias')).parishes.find((p) => p.id === first.body.id);
    expect(parish).toMatchObject({
      name: 'Jesús Obrero',
      sourceName: null,
      hasTerritory: true,
      isPublished: true,
      phone: null,
    });
  });

  it('rejects a vicariate from another diocese', async () => {
    const { id } = await setUp('ajena');
    const other = (await adminDiocese('guayaquil')).vicariates[0]!.id;
    const res = await agent
      .post(`/api/admin/dioceses/${id}/parishes`)
      .send({ name: 'X', vicariateId: other })
      .expect(422);
    expect(res.body.error).toBe('invalid-vicariate');
    await agent
      .post(`/api/admin/dioceses/${id}/parishes`)
      .send({ name: 'X', vicariateId: other, sourceName: 'X' })
      .expect(400);
  });

  it('deletes a parish together with its boundary and history', async () => {
    const { id, vicariateId } = await setUp('borrar-parroquia');
    const { id: parishId } = (
      await agent
        .post(`/api/admin/dioceses/${id}/parishes`)
        .send({ name: 'San Pedro', vicariateId })
        .expect(201)
    ).body as { id: number };
    const territory = `/api/admin/territories/parish/${parishId}`;
    await agent.put(`${territory}/draft`).send({ geometry: SQUARE }).expect(200);
    await agent.post(`${territory}/publish`).send({}).expect(200);
    expect(await db.prisma.territoryVersion.count({ where: { territory: { parishId } } })).toBe(2);

    expect(
      (
        await agent
          .delete(`/api/admin/parishes/${parishId}`)
          .send({ confirmName: 'San Pablo' })
          .expect(422)
      ).body.error,
    ).toBe('confirm-mismatch');
    await agent.delete(`/api/admin/parishes/${parishId}`).send({}).expect(400);

    await agent
      .delete(`/api/admin/parishes/${parishId}`)
      .send({ confirmName: 'San Pedro' })
      .expect(200);
    expect(await db.prisma.parish.findUnique({ where: { id: parishId } })).toBeNull();
    expect(await db.prisma.territory.count({ where: { parishId } })).toBe(0);
    const orphans = await db.prisma.territoryVersion.count({
      where: { territory: { parishId: null, dioceseId: null } },
    });
    expect(orphans).toBe(0);
    await agent
      .delete(`/api/admin/parishes/${parishId}`)
      .send({ confirmName: 'San Pedro' })
      .expect(404);
  });

  it('deletes a diocese only once it has no parishes', async () => {
    const { id, vicariateId, name } = await setUp('borrar-diocesis');
    const { id: parishId } = (
      await agent
        .post(`/api/admin/dioceses/${id}/parishes`)
        .send({ name: 'Única', vicariateId })
        .expect(201)
    ).body as { id: number };
    await agent
      .put(`/api/admin/territories/diocese/${id}/draft`)
      .send({ geometry: SQUARE })
      .expect(200);

    expect(
      (await agent.delete(`/api/admin/dioceses/${id}`).send({ confirmName: 'Otra' }).expect(422))
        .body.error,
    ).toBe('confirm-mismatch');
    expect(
      (await agent.delete(`/api/admin/dioceses/${id}`).send({ confirmName: name }).expect(409)).body
        .error,
    ).toBe('diocese-not-empty');

    await agent
      .delete(`/api/admin/parishes/${parishId}`)
      .send({ confirmName: 'Única' })
      .expect(200);
    await agent.delete(`/api/admin/dioceses/${id}`).send({ confirmName: name }).expect(200);

    expect(await db.prisma.diocese.findUnique({ where: { id } })).toBeNull();
    expect(await db.prisma.vicariate.count({ where: { dioceseId: id } })).toBe(0);
    expect(await db.prisma.territory.count({ where: { dioceseId: id } })).toBe(0);
    await agent.get('/api/admin/dioceses/borrar-diocesis').expect(404);
  });
});

describe('pickParishSlug', () => {
  it('adds the vicariate, then a number, when a slug is taken', () => {
    const used = new Set<string>();
    expect(pickParishSlug('San José', 'Norte', used)).toBe('san-jose');
    expect(pickParishSlug('San José', 'Norte', used)).toBe('san-jose-norte');
    expect(pickParishSlug('San José', 'Norte', used)).toBe('san-jose-2');
    expect(pickParishSlug('San José', 'Sur', used)).toBe('san-jose-sur');
    expect(pickParishSlug('¿?', 'Sur', used)).toBe('parroquia');
  });
});
