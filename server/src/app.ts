import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import type { HealthResponse } from '@parishmap/shared';
import { ZodError } from 'zod';
import type { AuthConfig } from './auth';
import type { PrismaClient } from './generated/prisma/client';
import { adminRouter, type AdminRouterOptions } from './routes/admin';
import { publicRouter } from './routes/public';
import { TerritoryError } from './territories';

const MAP_TILE_ORIGIN = 'https://tiles.openfreemap.org';

export interface AppOptions {
  auth?: AuthConfig | null;
  admin?: AdminRouterOptions;
  /** Folder holding the built website. Left out in development, where Vite serves it. */
  webRoot?: string;
  /** Number of proxies in front of the app, so login limits see real client addresses. */
  trustProxy?: number;
  /** Adds HTTPS-only security headers. Enable it only where the site is served over HTTPS. */
  https?: boolean;
}

function originOf(url: string | undefined): string[] {
  if (!url) return [];
  try {
    return [new URL(url.replace(/[{}]/g, '')).origin];
  } catch {
    return [];
  }
}

export function createApp(prisma: PrismaClient, options: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (options.trustProxy) app.set('trust proxy', options.trustProxy);

  const imagery = originOf(options.admin?.satellite?.tileUrl);
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          scriptSrc: ["'self'"],
          // MapLibre and the drawing library set element styles directly.
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', MAP_TILE_ORIGIN, ...imagery],
          fontSrc: ["'self'"],
          connectSrc: ["'self'", MAP_TILE_ORIGIN, ...imagery],
          // MapLibre runs its map processing in web workers.
          workerSrc: ["'self'", 'blob:'],
          upgradeInsecureRequests: options.https ? [] : null,
        },
      },
      strictTransportSecurity: options.https ? undefined : false,
    }),
  );

  app.get('/api/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    const body: HealthResponse = { status: 'ok', database: 'ok' };
    res.set('Cache-Control', 'no-store').json(body);
  });

  // Mounted first, so the public router's cache headers never apply to admin responses.
  app.use('/api/admin', adminRouter(prisma, options.auth ?? null, options.admin));
  app.use('/api', publicRouter(prisma));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not-found' });
  });

  if (options.webRoot) {
    const { webRoot } = options;
    const indexFile = join(webRoot, 'index.html');
    if (!existsSync(indexFile)) {
      throw new Error(`The website isn't built: ${indexFile} is missing. Run "npm run build".`);
    }

    // File names under assets/ include a hash of their contents, so they never change.
    app.use(
      '/assets',
      express.static(join(webRoot, 'assets'), {
        immutable: true,
        maxAge: '1y',
        fallthrough: false,
      }),
    );
    app.use(express.static(webRoot, { index: false, maxAge: '1h' }));

    // A path with a file extension is a missing file. Answering with the page instead would
    // hide the error: a missing script would appear to load, then fail in a confusing way.
    app.get(/\.[a-z0-9]+$/i, (_req, res) => {
      res.status(404).json({ error: 'not-found' });
    });

    // Every other page is handled by the website's own routes.
    app.get(/.*/, (req, res) => {
      res.set('Cache-Control', 'no-cache');
      if (req.path === '/admin' || req.path.startsWith('/admin/')) {
        res.set('X-Robots-Tag', 'noindex');
      }
      res.sendFile(indexFile);
    });
  }

  const handleError: ErrorRequestHandler = (error: { status?: number }, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    res.set('Cache-Control', 'no-store');
    if (error instanceof TerritoryError) {
      res.status(error.status).json({ error: error.code, ...error.details });
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({ error: 'invalid-request' });
      return;
    }
    // Includes malformed or oversized JSON, and missing files under /assets.
    if (error.status && error.status >= 400 && error.status < 500) {
      res
        .status(error.status)
        .json({ error: error.status === 404 ? 'not-found' : 'invalid-request' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'server-error' });
  };
  app.use(handleError);

  return app;
}
