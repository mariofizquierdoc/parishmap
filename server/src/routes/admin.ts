import type {
  AdminConfig,
  AdminDiocese,
  AdminParish,
  SatelliteConfig,
  TerritoryOwnerKind,
} from '@parishmap/shared/admin';
import type { Confidence } from '@parishmap/shared';
import cookieParser from 'cookie-parser';
import express, { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import {
  checkCredentials,
  createSessionToken,
  requireAdmin,
  SESSION_COOKIE,
  sessionCookieOptions,
  type AuthConfig,
} from '../auth';
import { CONFIDENCE_LEVELS } from '../domain';
import type { PrismaClient } from '../generated/prisma/client';
import {
  checkShape,
  exportDiocese,
  findOwner,
  getProgress,
  getTerritory,
  listVersions,
  publish,
  readShape,
  restoreVersion,
  saveDraft,
  TerritoryError,
  trim,
  unpublish,
  updateMeta,
} from '../territories';

export interface AdminRouterOptions {
  /** Failed login attempts allowed per address in each 15-minute window. */
  maxLoginAttempts?: number;
  satellite?: SatelliteConfig | null;
}

const optionalText = z
  .string()
  .trim()
  .max(500)
  .transform((value) => value || null)
  .nullable();

const parishUpdate = z
  .object({
    name: z.string().trim().min(1).max(200),
    vicariateId: z.number().int().positive(),
    hasTerritory: z.boolean(),
    isPublished: z.boolean(),
    address: optionalText,
    phone: optionalText,
    email: optionalText,
    website: optionalText.refine(
      (value) => value === null || /^https?:\/\/\S+$/i.test(value),
      'Website must start with http:// or https://',
    ),
    priest: optionalText,
  })
  .partial()
  .strict();

const metaUpdate = z
  .object({
    confidence: z.enum(CONFIDENCE_LEVELS),
    notes: z.string().max(20_000),
    sourceNotes: z.string().max(20_000),
  })
  .partial()
  .strict();

const publishBody = z.object({ confirmOverlaps: z.boolean().default(false) }).strict();

function intParam(req: Request, name: string): number {
  const value = Number(req.params[name]);
  if (!Number.isInteger(value) || value <= 0) throw new TerritoryError(404, 'not-found');
  return value;
}

function ownerParams(req: Request): { kind: TerritoryOwnerKind; id: number } {
  const { kind } = req.params;
  if (kind !== 'parish' && kind !== 'diocese') throw new TerritoryError(404, 'not-found');
  return { kind, id: intParam(req, 'id') };
}

/**
 * All routes after `requireAdmin` need a valid session. Add new admin routes there.
 *
 * Cross-site requests are blocked by the SameSite=Strict cookie, and changes require a JSON
 * body, which a plain cross-site form can't send.
 */
export function adminRouter(
  prisma: PrismaClient,
  auth: AuthConfig | null,
  options: AdminRouterOptions = {},
) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  if (!auth) {
    router.use((_req, res) => {
      res.status(503).json({ error: 'admin-not-configured' });
    });
    return router;
  }

  router.use(express.json({ limit: '10mb' }));
  router.use(cookieParser());

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: options.maxLoginAttempts ?? 10,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too-many-attempts' },
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'invalid-request' });
      return;
    }
    if (!(await checkCredentials(auth, username, password))) {
      res.status(401).json({ error: 'invalid-credentials' });
      return;
    }
    res.cookie(SESSION_COOKIE, await createSessionToken(auth), sessionCookieOptions(auth));
    res.json({ authenticated: true });
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(auth));
    res.json({ authenticated: false });
  });

  router.use(requireAdmin(auth));

  router.get('/me', (_req, res) => {
    res.json({ authenticated: true });
  });

  router.get('/config', (_req, res) => {
    const body: AdminConfig = { satellite: options.satellite ?? null };
    res.json(body);
  });

  router.get('/dioceses/:slug', async (req, res) => {
    const diocese = await prisma.diocese.findUnique({
      where: { slug: req.params.slug },
      include: {
        vicariates: { orderBy: { sortOrder: 'asc' } },
        parishes: {
          include: { territory: true, vicariate: true },
          orderBy: [{ vicariate: { sortOrder: 'asc' } }, { name: 'asc' }],
        },
      },
    });
    if (!diocese) throw new TerritoryError(404, 'not-found');

    const body: AdminDiocese = {
      id: diocese.id,
      slug: diocese.slug,
      name: diocese.name,
      vicariates: diocese.vicariates.map(({ id, name }) => ({ id, name })),
      parishes: diocese.parishes.map((parish): AdminParish => {
        const territory = parish.territory;
        return {
          id: parish.id,
          slug: parish.slug,
          name: parish.name,
          sourceName: parish.sourceName,
          vicariateId: parish.vicariateId,
          vicariate: parish.vicariate.name,
          hasTerritory: parish.hasTerritory,
          isPublished: parish.isPublished,
          address: parish.address,
          phone: parish.phone,
          email: parish.email,
          website: parish.website,
          priest: parish.priest,
          hasDraft: Boolean(territory?.draftGeojson),
          hasPublished: Boolean(territory?.publishedGeojson),
          hasUnpublishedChanges: Boolean(
            territory?.draftGeojson && territory.draftGeojson !== territory.publishedGeojson,
          ),
          confidence: territory ? (territory.confidence as Confidence) : null,
        };
      }),
    };
    res.json(body);
  });

  router.get('/dioceses/:slug/progress', async (req, res) => {
    const diocese = await prisma.diocese.findUnique({ where: { slug: req.params.slug } });
    if (!diocese) throw new TerritoryError(404, 'not-found');
    res.json(await getProgress(prisma, diocese.id));
  });

  router.get('/dioceses/:slug/export', async (req, res) => {
    const diocese = await prisma.diocese.findUnique({ where: { slug: req.params.slug } });
    if (!diocese) throw new TerritoryError(404, 'not-found');

    const parishId = req.query.parish ? Number(req.query.parish) : undefined;
    if (parishId !== undefined && !Number.isInteger(parishId)) {
      throw new TerritoryError(404, 'not-found');
    }
    const name = parishId ? `${diocese.slug}-parroquia-${parishId}` : diocese.slug;
    res.set('Content-Disposition', `attachment; filename="${name}.geojson"`);
    res.json(await exportDiocese(prisma, diocese.id, parishId));
  });

  router.patch('/parishes/:id', async (req, res) => {
    const id = intParam(req, 'id');
    const data = parishUpdate.parse(req.body);
    const parish = await prisma.parish.findUnique({ where: { id } });
    if (!parish) throw new TerritoryError(404, 'not-found');

    if (data.vicariateId !== undefined) {
      const vicariate = await prisma.vicariate.findFirst({
        where: { id: data.vicariateId, dioceseId: parish.dioceseId },
      });
      if (!vicariate) throw new TerritoryError(422, 'invalid-vicariate');
    }

    // The slug is left alone, so existing shared links keep working after a name correction.
    await prisma.parish.update({ where: { id }, data });
    res.json({ updated: true });
  });

  const territoryPath = '/territories/:kind/:id';

  router.get(territoryPath, async (req, res) => {
    const { kind, id } = ownerParams(req);
    res.json(await getTerritory(prisma, await findOwner(prisma, kind, id)));
  });

  router.put(`${territoryPath}/draft`, async (req, res) => {
    const { kind, id } = ownerParams(req);
    const owner = await findOwner(prisma, kind, id);
    await saveDraft(
      prisma,
      owner,
      readShape((req.body as { geometry?: unknown }).geometry),
      'SAVE',
    );
    res.json(await getTerritory(prisma, owner));
  });

  router.post(`${territoryPath}/import`, async (req, res) => {
    const { kind, id } = ownerParams(req);
    const owner = await findOwner(prisma, kind, id);
    await saveDraft(
      prisma,
      owner,
      readShape((req.body as { geojson?: unknown }).geojson),
      'IMPORT',
    );
    res.json(await getTerritory(prisma, owner));
  });

  router.post(`${territoryPath}/check`, async (req, res) => {
    const { kind, id } = ownerParams(req);
    const owner = await findOwner(prisma, kind, id);
    const shape = readShape((req.body as { geometry?: unknown }).geometry);
    res.json(await checkShape(prisma, owner, shape));
  });

  router.post(`${territoryPath}/trim`, async (req, res) => {
    const { kind, id } = ownerParams(req);
    const owner = await findOwner(prisma, kind, id);
    const shape = readShape((req.body as { geometry?: unknown }).geometry);
    res.json({ geometry: await trim(prisma, owner, shape) });
  });

  router.patch(territoryPath, async (req, res) => {
    const { kind, id } = ownerParams(req);
    const owner = await findOwner(prisma, kind, id);
    await updateMeta(prisma, owner, metaUpdate.parse(req.body));
    res.json(await getTerritory(prisma, owner));
  });

  router.post(`${territoryPath}/publish`, async (req, res) => {
    const { kind, id } = ownerParams(req);
    const owner = await findOwner(prisma, kind, id);
    await publish(prisma, owner, publishBody.parse(req.body ?? {}).confirmOverlaps);
    res.json(await getTerritory(prisma, owner));
  });

  router.post(`${territoryPath}/unpublish`, async (req, res) => {
    const { kind, id } = ownerParams(req);
    const owner = await findOwner(prisma, kind, id);
    await unpublish(prisma, owner);
    res.json(await getTerritory(prisma, owner));
  });

  router.get(`${territoryPath}/versions`, async (req, res) => {
    const { kind, id } = ownerParams(req);
    res.json(await listVersions(prisma, await findOwner(prisma, kind, id)));
  });

  router.post(`${territoryPath}/versions/:versionId/restore`, async (req, res) => {
    const { kind, id } = ownerParams(req);
    const owner = await findOwner(prisma, kind, id);
    await restoreVersion(prisma, owner, intParam(req, 'versionId'));
    res.json(await getTerritory(prisma, owner));
  });

  router.use((_req, res) => {
    res.status(404).json({ error: 'not-found' });
  });

  return router;
}
