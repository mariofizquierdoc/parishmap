import type { AdminDioceseSummary } from '@parishmap/shared/admin';
import { isValidSlug, RESERVED_DIOCESE_SLUGS, slugify } from '@parishmap/shared/slug';
import type { PrismaClient } from './generated/prisma/client';
import { TerritoryError } from './territories';

/**
 * Creating and deleting dioceses, vicariates and parishes.
 *
 * Slugs are part of public links, so they are chosen once, when a record is created, and never
 * changed afterward.
 */

export interface DioceseInput {
  name: string;
  slug: string;
  sourceUrl?: string | null;
  isPublished?: boolean;
}

export interface ParishInput {
  name: string;
  vicariateId: number;
  slug?: string;
  hasTerritory?: boolean;
  isPublished?: boolean;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  priest?: string | null;
}

function checkConfirmation(expected: string, given: string) {
  if (given.trim() !== expected.trim()) throw new TerritoryError(422, 'confirm-mismatch');
}

async function findDiocese(prisma: PrismaClient, id: number) {
  const diocese = await prisma.diocese.findUnique({ where: { id } });
  if (!diocese) throw new TerritoryError(404, 'not-found');
  return diocese;
}

async function findVicariate(prisma: PrismaClient, id: number) {
  const vicariate = await prisma.vicariate.findUnique({ where: { id } });
  if (!vicariate) throw new TerritoryError(404, 'not-found');
  return vicariate;
}

export async function listDioceses(prisma: PrismaClient): Promise<AdminDioceseSummary[]> {
  const dioceses = await prisma.diocese.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { parishes: true, vicariates: true } },
      territory: { select: { draftGeojson: true, publishedGeojson: true } },
    },
  });
  return dioceses.map((diocese) => ({
    id: diocese.id,
    slug: diocese.slug,
    name: diocese.name,
    sourceUrl: diocese.sourceUrl,
    isPublished: diocese.isPublished,
    parishCount: diocese._count.parishes,
    vicariateCount: diocese._count.vicariates,
    outlineDrawn: Boolean(diocese.territory?.draftGeojson ?? diocese.territory?.publishedGeojson),
  }));
}

export async function createDiocese(prisma: PrismaClient, input: DioceseInput) {
  const { slug } = input;
  if (!isValidSlug(slug)) throw new TerritoryError(422, 'invalid-slug');
  if (RESERVED_DIOCESE_SLUGS.includes(slug)) throw new TerritoryError(422, 'slug-reserved');
  if (await prisma.diocese.findUnique({ where: { slug } })) {
    throw new TerritoryError(409, 'slug-taken');
  }
  return prisma.diocese.create({
    data: {
      name: input.name,
      slug,
      sourceUrl: input.sourceUrl ?? null,
      isPublished: input.isPublished ?? false,
    },
  });
}

export async function updateDiocese(
  prisma: PrismaClient,
  id: number,
  data: Partial<Omit<DioceseInput, 'slug'>>,
) {
  await findDiocese(prisma, id);
  return prisma.diocese.update({ where: { id }, data });
}

/** Only an empty diocese can be deleted, so a mistake can never take parish boundaries with it. */
export async function deleteDiocese(prisma: PrismaClient, id: number, confirmName: string) {
  const diocese = await findDiocese(prisma, id);
  checkConfirmation(diocese.name, confirmName);
  if ((await prisma.parish.count({ where: { dioceseId: id } })) > 0) {
    throw new TerritoryError(409, 'diocese-not-empty');
  }
  // Deleting the outline also deletes its versions, through the cascade on TerritoryVersion.
  await prisma.$transaction([
    prisma.territory.deleteMany({ where: { dioceseId: id } }),
    prisma.vicariate.deleteMany({ where: { dioceseId: id } }),
    prisma.diocese.delete({ where: { id } }),
  ]);
}

async function checkVicariateName(
  prisma: PrismaClient,
  dioceseId: number,
  name: string,
  exceptId?: number,
) {
  const existing = await prisma.vicariate.findUnique({
    where: { dioceseId_name: { dioceseId, name } },
  });
  if (existing && existing.id !== exceptId) throw new TerritoryError(409, 'vicariate-exists');
}

export async function createVicariate(prisma: PrismaClient, dioceseId: number, name: string) {
  await findDiocese(prisma, dioceseId);
  await checkVicariateName(prisma, dioceseId, name);
  const last = await prisma.vicariate.aggregate({
    where: { dioceseId },
    _max: { sortOrder: true },
  });
  return prisma.vicariate.create({
    data: { dioceseId, name, sortOrder: (last._max.sortOrder ?? -1) + 1 },
  });
}

export async function renameVicariate(prisma: PrismaClient, id: number, name: string) {
  const vicariate = await findVicariate(prisma, id);
  await checkVicariateName(prisma, vicariate.dioceseId, name, id);
  return prisma.vicariate.update({ where: { id }, data: { name } });
}

/** `ids` must list every vicariate of the diocese exactly once, in the new order. */
export async function reorderVicariates(prisma: PrismaClient, dioceseId: number, ids: number[]) {
  await findDiocese(prisma, dioceseId);
  const current = await prisma.vicariate.findMany({ where: { dioceseId }, select: { id: true } });
  const expected = new Set(current.map((vicariate) => vicariate.id));
  if (
    ids.length !== expected.size ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => expected.has(id))
  ) {
    throw new TerritoryError(422, 'invalid-order');
  }
  await prisma.$transaction(
    ids.map((id, sortOrder) => prisma.vicariate.update({ where: { id }, data: { sortOrder } })),
  );
}

export async function deleteVicariate(prisma: PrismaClient, id: number) {
  await findVicariate(prisma, id);
  if ((await prisma.parish.count({ where: { vicariateId: id } })) > 0) {
    throw new TerritoryError(409, 'vicariate-not-empty');
  }
  await prisma.vicariate.delete({ where: { id } });
}

/**
 * Picks a slug no other parish in the diocese uses: the name alone, then with the vicariate added,
 * then with a number. Adds the result to `used`, so a caller creating several parishes can reuse it.
 */
export function pickParishSlug(name: string, vicariateName: string, used: Set<string>): string {
  const base = slugify(name) || 'parroquia';
  const candidates = [base, `${base}-${slugify(vicariateName)}`];
  let slug = candidates.find((candidate) => !used.has(candidate));
  for (let n = 2; !slug; n += 1) {
    if (!used.has(`${base}-${n}`)) slug = `${base}-${n}`;
  }
  used.add(slug);
  return slug;
}

/** Parishes created here have no `sourceName`, so the importer never matches or reports them. */
export async function createParish(prisma: PrismaClient, dioceseId: number, input: ParishInput) {
  await findDiocese(prisma, dioceseId);
  const vicariate = await prisma.vicariate.findFirst({
    where: { id: input.vicariateId, dioceseId },
  });
  if (!vicariate) throw new TerritoryError(422, 'invalid-vicariate');

  let { slug } = input;
  if (slug !== undefined) {
    if (!isValidSlug(slug)) throw new TerritoryError(422, 'invalid-slug');
    if (await prisma.parish.findUnique({ where: { dioceseId_slug: { dioceseId, slug } } })) {
      throw new TerritoryError(409, 'slug-taken');
    }
  } else {
    const existing = await prisma.parish.findMany({ where: { dioceseId }, select: { slug: true } });
    slug = pickParishSlug(input.name, vicariate.name, new Set(existing.map((p) => p.slug)));
  }

  return prisma.parish.create({ data: { ...input, dioceseId, slug } });
}

/** Deletes the parish together with its boundary and the boundary's whole history. */
export async function deleteParish(prisma: PrismaClient, id: number, confirmName: string) {
  const parish = await prisma.parish.findUnique({ where: { id } });
  if (!parish) throw new TerritoryError(404, 'not-found');
  checkConfirmation(parish.name, confirmName);
  await prisma.$transaction([
    prisma.territory.deleteMany({ where: { parishId: id } }),
    prisma.parish.delete({ where: { id } }),
  ]);
}
