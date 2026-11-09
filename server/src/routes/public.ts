import { Router, type Response } from 'express';
import type {
  Confidence,
  PublicDiocese,
  PublicDioceseSummary,
  PublicParish,
  PublicParishList,
  PublicTerritoryCollection,
} from '@parishmap/shared';
import type { MultiPolygon } from 'geojson';
import type { PrismaClient } from '../generated/prisma/client';

const collator = new Intl.Collator('es', { sensitivity: 'base' });

/**
 * Browsers must check for changes each time, so a publish shows up immediately. It stays cheap:
 * when nothing changed, the response's ETag lets the server answer with an empty 304.
 */
function setPublicCache(res: Response) {
  res.set('Cache-Control', 'no-cache');
}

/**
 * Every response is built field by field, and queries select only public columns.
 * Territory notes and drafts must never reach this router, even by accident.
 */
export function publicRouter(prisma: PrismaClient) {
  const router = Router();
  router.use((_req, res, next) => {
    setPublicCache(res);
    next();
  });

  router.get('/dioceses', async (_req, res) => {
    const dioceses = await prisma.diocese.findMany({
      select: { slug: true, name: true },
      orderBy: { name: 'asc' },
    });
    const body: PublicDioceseSummary[] = dioceses;
    res.json(body);
  });

  router.get('/dioceses/:slug', async (req, res) => {
    const diocese = await prisma.diocese.findUnique({
      where: { slug: req.params.slug },
      select: {
        slug: true,
        name: true,
        sourceUrl: true,
        territory: { select: { publishedGeojson: true } },
      },
    });
    if (!diocese) {
      res.status(404).json({ error: 'not-found' });
      return;
    }
    const published = diocese.territory?.publishedGeojson;
    const body: PublicDiocese = {
      slug: diocese.slug,
      name: diocese.name,
      sourceUrl: diocese.sourceUrl,
      outline: published ? (JSON.parse(published) as MultiPolygon) : null,
    };
    res.json(body);
  });

  router.get('/dioceses/:slug/parishes', async (req, res) => {
    const diocese = await prisma.diocese.findUnique({
      where: { slug: req.params.slug },
      select: {
        vicariates: {
          orderBy: { sortOrder: 'asc' },
          select: {
            name: true,
            parishes: {
              where: { isPublished: true },
              select: {
                slug: true,
                name: true,
                hasTerritory: true,
                address: true,
                phone: true,
                email: true,
                website: true,
                priest: true,
                territory: {
                  select: { publishedGeojson: true, publishedAt: true, confidence: true },
                },
              },
            },
          },
        },
      },
    });
    if (!diocese) {
      res.status(404).json({ error: 'not-found' });
      return;
    }

    const body: PublicParishList = {
      vicariates: diocese.vicariates.map((vicariate) => ({
        name: vicariate.name,
        parishes: vicariate.parishes
          .map((parish): PublicParish => {
            const shown = parish.hasTerritory && Boolean(parish.territory?.publishedGeojson);
            return {
              slug: parish.slug,
              name: parish.name,
              vicariate: vicariate.name,
              hasTerritory: parish.hasTerritory,
              hasPublishedTerritory: shown,
              confidence: shown ? (parish.territory!.confidence as Confidence) : null,
              territoryUpdatedAt: shown
                ? (parish.territory!.publishedAt?.toISOString() ?? null)
                : null,
              address: parish.address,
              phone: parish.phone,
              email: parish.email,
              website: parish.website,
              priest: parish.priest,
            };
          })
          .sort((a, b) => collator.compare(a.name, b.name)),
      })),
    };
    res.json(body);
  });

  router.get('/dioceses/:slug/territories', async (req, res) => {
    const diocese = await prisma.diocese.findUnique({
      where: { slug: req.params.slug },
      select: { id: true },
    });
    if (!diocese) {
      res.status(404).json({ error: 'not-found' });
      return;
    }

    const parishes = await prisma.parish.findMany({
      where: {
        dioceseId: diocese.id,
        isPublished: true,
        hasTerritory: true,
        territory: { is: { publishedGeojson: { not: null } } },
      },
      select: {
        slug: true,
        name: true,
        territory: { select: { publishedGeojson: true, confidence: true } },
      },
    });

    const body: PublicTerritoryCollection = {
      type: 'FeatureCollection',
      features: parishes.map((parish) => ({
        type: 'Feature',
        geometry: JSON.parse(parish.territory!.publishedGeojson!) as MultiPolygon,
        properties: {
          slug: parish.slug,
          name: parish.name,
          confidence: parish.territory!.confidence as Confidence,
        },
      })),
    };
    res.json(body);
  });

  return router;
}
