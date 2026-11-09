import { slugify } from '../domain';
import type { PrismaClient } from '../generated/prisma/client';
import type { ParsedParish } from './parse-guayaquil';

export interface ImportResult {
  created: { name: string; vicariate: string }[];
  unchanged: number;
  /** In the database but no longer on the page. Reported only; nothing is deleted. */
  missingFromSource: { name: string; vicariate: string }[];
}

/**
 * Adds parishes that aren't in the database yet.
 *
 * Existing parishes are never updated or deleted, so admin edits survive a re-import.
 * Throws before writing anything if the page names an unknown vicariate.
 */
export async function applyImport(
  prisma: PrismaClient,
  dioceseSlug: string,
  parsed: ParsedParish[],
): Promise<ImportResult> {
  const diocese = await prisma.diocese.findUniqueOrThrow({
    where: { slug: dioceseSlug },
    include: { vicariates: true, parishes: { include: { vicariate: true } } },
  });

  const vicariatesByHeading = new Map(diocese.vicariates.map((v) => [v.name.toUpperCase(), v]));
  for (const { vicariate } of parsed) {
    if (!vicariatesByHeading.has(vicariate)) {
      throw new Error(`Unknown vicariate on source page: "${vicariate}"`);
    }
  }

  const matchKey = (vicariateId: number, sourceName: string | null) =>
    `${vicariateId}|${sourceName}`;
  const existingKeys = new Set(diocese.parishes.map((p) => matchKey(p.vicariateId, p.sourceName)));
  const usedSlugs = new Set(diocese.parishes.map((p) => p.slug));
  const seenKeys = new Set<string>();

  const result: ImportResult = { created: [], unchanged: 0, missingFromSource: [] };
  const toCreate: {
    dioceseId: number;
    vicariateId: number;
    slug: string;
    name: string;
    sourceName: string;
  }[] = [];

  for (const parish of parsed) {
    const vicariate = vicariatesByHeading.get(parish.vicariate)!;
    const key = matchKey(vicariate.id, parish.sourceName);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    if (existingKeys.has(key)) {
      result.unchanged += 1;
      continue;
    }

    let slug = slugify(parish.name);
    if (usedSlugs.has(slug)) slug = `${slug}-${slugify(vicariate.name)}`;
    if (usedSlugs.has(slug)) {
      throw new Error(`Could not build a unique slug for "${parish.name}"`);
    }
    usedSlugs.add(slug);

    toCreate.push({
      dioceseId: diocese.id,
      vicariateId: vicariate.id,
      slug,
      name: parish.name,
      sourceName: parish.sourceName,
    });
    result.created.push({ name: parish.name, vicariate: vicariate.name });
  }

  await prisma.$transaction(toCreate.map((data) => prisma.parish.create({ data })));

  for (const parish of diocese.parishes) {
    if (parish.sourceName && !seenKeys.has(matchKey(parish.vicariateId, parish.sourceName))) {
      result.missingFromSource.push({ name: parish.name, vicariate: parish.vicariate.name });
    }
  }

  return result;
}
