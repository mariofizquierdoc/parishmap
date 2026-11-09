import { createPrismaClient } from '../src/db';
import { applyImport } from '../src/importer/apply-import';
import { parseGuayaquilPage } from '../src/importer/parse-guayaquil';
import { reviewParishes } from '../src/importer/review';
import { GUAYAQUIL_SLUG, GUAYAQUIL_SOURCE_URL, seedGuayaquil } from '../src/seed';

const response = await fetch(GUAYAQUIL_SOURCE_URL, {
  headers: { 'User-Agent': 'ParishMapImporter/0.1' },
});
if (!response.ok) throw new Error(`Could not fetch the source page: HTTP ${response.status}`);

const parsed = parseGuayaquilPage(await response.text());
if (parsed.length === 0) {
  throw new Error('No parishes found. The source page layout may have changed.');
}

const prisma = createPrismaClient();
try {
  await seedGuayaquil(prisma);
  const result = await applyImport(prisma, GUAYAQUIL_SLUG, parsed);

  console.log(`Found on page: ${parsed.length}`);
  console.log(`Created: ${result.created.length}`);
  console.log(`Already imported: ${result.unchanged}`);

  console.log(`\nPer vicariate:`);
  const counts = new Map<string, number>();
  for (const { vicariate } of parsed) counts.set(vicariate, (counts.get(vicariate) ?? 0) + 1);
  for (const [vicariate, count] of counts) console.log(`  ${vicariate}: ${count}`);

  if (result.missingFromSource.length > 0) {
    console.log(`\nIn the database but no longer on the page (not deleted):`);
    for (const { name, vicariate } of result.missingFromSource) {
      console.log(`  ${name} (${vicariate})`);
    }
  }

  const notes = reviewParishes(parsed);
  if (notes.length > 0) {
    console.log(`\nFor review (nothing was changed):`);
    for (const { name, vicariate, reason } of notes) {
      console.log(`  ${name} (${vicariate}): ${reason}`);
    }
  }
} finally {
  await prisma.$disconnect();
}
