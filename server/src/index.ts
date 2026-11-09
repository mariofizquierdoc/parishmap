import { fileURLToPath } from 'node:url';
import type { SatelliteConfig } from '@parishmap/shared/admin';
import { createApp } from './app';
import { loadAuthConfig } from './auth';
import { createPrismaClient } from './db';

const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3001);
const auth = loadAuthConfig();
const prisma = createPrismaClient();

if (!auth) {
  console.warn('Admin login is off. Run "npm run admin:create -w server" to set it up.');
}

// Served only to logged-in admins, so an API key in the URL never reaches the public site.
const satellite: SatelliteConfig | null = process.env.SATELLITE_TILE_URL
  ? {
      tileUrl: process.env.SATELLITE_TILE_URL,
      attribution: process.env.SATELLITE_ATTRIBUTION ?? '',
    }
  : null;

createApp(prisma, {
  auth,
  admin: { satellite },
  webRoot: isProduction ? fileURLToPath(new URL('../../web/dist/', import.meta.url)) : undefined,
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
  https: isProduction && process.env.HTTPS !== 'false',
}).listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
});
