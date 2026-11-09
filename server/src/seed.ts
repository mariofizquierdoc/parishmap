import type { PrismaClient } from './generated/prisma/client';

export const GUAYAQUIL_SLUG = 'guayaquil';
export const GUAYAQUIL_SOURCE_URL = 'https://arquidiocesisdeguayaquil.org.ec/parroquias/';

/** In the order the archdiocese's page lists them. */
export const GUAYAQUIL_VICARIATES = [
  'Centro',
  'Noroeste',
  'Norte',
  'Sur',
  'Suroeste',
  'Vía a la Costa',
  'Vía a Daule',
] as const;

/** Safe to run repeatedly. Existing rows keep any edits made in the admin site. */
export async function seedGuayaquil(prisma: PrismaClient) {
  const diocese = await prisma.diocese.upsert({
    where: { slug: GUAYAQUIL_SLUG },
    update: {},
    create: {
      slug: GUAYAQUIL_SLUG,
      name: 'Arquidiócesis de Guayaquil',
      sourceUrl: GUAYAQUIL_SOURCE_URL,
    },
  });

  for (const [sortOrder, name] of GUAYAQUIL_VICARIATES.entries()) {
    await prisma.vicariate.upsert({
      where: { dioceseId_name: { dioceseId: diocese.id, name } },
      update: {},
      create: { dioceseId: diocese.id, name, sortOrder },
    });
  }

  return diocese;
}
