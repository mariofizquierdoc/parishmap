import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyImport } from '../src/importer/apply-import';
import { parseGuayaquilPage } from '../src/importer/parse-guayaquil';
import { reviewParishes } from '../src/importer/review';
import { GUAYAQUIL_SLUG, seedGuayaquil } from '../src/seed';
import { createTestDatabase } from './helpers/test-db';

const html = readFileSync(new URL('./fixtures/guayaquil-parroquias.html', import.meta.url), 'utf8');
const parsed = parseGuayaquilPage(html);

function namesIn(vicariate: string) {
  return parsed.filter((p) => p.vicariate === vicariate).map((p) => p.name);
}

describe('parseGuayaquilPage', () => {
  it('finds the expected number of parishes in each vicariate', () => {
    const counts: Record<string, number> = {};
    for (const { vicariate } of parsed) counts[vicariate] = (counts[vicariate] ?? 0) + 1;

    expect(counts).toEqual({
      CENTRO: 27,
      NOROESTE: 16,
      NORTE: 24,
      SUR: 34,
      SUROESTE: 28,
      'VÍA A LA COSTA': 12,
      'VÍA A DAULE': 24,
    });
    expect(parsed).toHaveLength(165);
  });

  it('reads both the list and the paragraph column, without list numbers', () => {
    const centro = namesIn('CENTRO');
    expect(centro[0]).toBe('Cristo Redentor');
    expect(centro[12]).toBe('Sagrada Familia');
    expect(centro[26]).toBe('Señor de la Buena Esperanza');
    expect(parsed.every((p) => !/^\d/.test(p.sourceName))).toBe(true);
  });

  it('removes extra spaces from the name but keeps the source text', () => {
    const parish = parsed.find((p) => p.name === 'Ángel de la Guarda');
    // The source separates these words with a non-breaking space and a regular space.
    expect(parish?.sourceName).toBe('Ángel de  la Guarda');
  });

  it('returns nothing for a page without vicariate sections', () => {
    expect(parseGuayaquilPage('<html><body><ol><li>Not a parish</li></ol></body></html>')).toEqual(
      [],
    );
  });
});

describe('reviewParishes', () => {
  const notes = reviewParishes(parsed);
  const reasonsFor = (name: string) => notes.filter((n) => n.name === name).map((n) => n.reason);

  it('flags typos, repeated text, and rectoral churches', () => {
    expect(reasonsFor('El Buatismo de Jesús')).toContain('possible typo of "Bautismo"');
    expect(
      reasonsFor('San Antonio María Claret San Antonio María Claret (Iglesia La Redonda)'),
    ).toContain('text appears to be repeated');
    expect(reasonsFor('Iglesia Rectoral San José')).toContain(
      'rectoral church: may have no territory',
    );
  });

  it('flags the same name in different vicariates, ignoring case', () => {
    expect(reasonsFor('Jesús El Buen Pastor')).toContain('same name appears in: SUR, VÍA A DAULE');
    expect(reasonsFor('Jesús el Buen Pastor')).toContain('same name appears in: SUR, VÍA A DAULE');
  });
});

describe('applyImport', () => {
  let db: ReturnType<typeof createTestDatabase>;

  beforeEach(async () => {
    db = createTestDatabase();
    await seedGuayaquil(db.prisma);
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('creates all parishes with unique slugs and correct vicariates', async () => {
    const result = await applyImport(db.prisma, GUAYAQUIL_SLUG, parsed);
    expect(result.created).toHaveLength(165);

    const parishes = await db.prisma.parish.findMany({ include: { vicariate: true } });
    expect(parishes).toHaveLength(165);
    expect(new Set(parishes.map((p) => p.slug)).size).toBe(165);

    const sagrada = parishes.find((p) => p.name === 'Sagrada Familia');
    expect(sagrada?.vicariate.name).toBe('Centro');
    expect(sagrada?.slug).toBe('sagrada-familia');
  });

  it('gives parishes with the same name different slugs', async () => {
    await applyImport(db.prisma, GUAYAQUIL_SLUG, parsed);
    const parishes = await db.prisma.parish.findMany({
      where: { slug: { startsWith: 'jesus-el-buen-pastor' } },
    });
    expect(parishes.map((p) => p.slug).sort()).toEqual([
      'jesus-el-buen-pastor',
      'jesus-el-buen-pastor-via-a-daule',
    ]);
  });

  it('changes nothing on a second run', async () => {
    await applyImport(db.prisma, GUAYAQUIL_SLUG, parsed);
    const before = await db.prisma.parish.findMany({ orderBy: { id: 'asc' } });

    const second = await applyImport(db.prisma, GUAYAQUIL_SLUG, parsed);
    expect(second.created).toHaveLength(0);
    expect(second.unchanged).toBe(165);
    expect(second.missingFromSource).toHaveLength(0);
    expect(await db.prisma.parish.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('keeps admin corrections when re-importing', async () => {
    await applyImport(db.prisma, GUAYAQUIL_SLUG, parsed);
    await db.prisma.parish.updateMany({
      where: { sourceName: 'El Buatismo de Jesús' },
      data: { name: 'El Bautismo de Jesús' },
    });

    const second = await applyImport(db.prisma, GUAYAQUIL_SLUG, parsed);
    expect(second.created).toHaveLength(0);
    const parish = await db.prisma.parish.findFirst({
      where: { sourceName: 'El Buatismo de Jesús' },
    });
    expect(parish?.name).toBe('El Bautismo de Jesús');
  });

  it('reports parishes missing from the source without deleting them', async () => {
    await applyImport(db.prisma, GUAYAQUIL_SLUG, parsed);
    const result = await applyImport(db.prisma, GUAYAQUIL_SLUG, parsed.slice(1));

    expect(result.missingFromSource).toEqual([{ name: 'Cristo Redentor', vicariate: 'Centro' }]);
    expect(await db.prisma.parish.count()).toBe(165);
  });

  it('writes nothing if the page names an unknown vicariate', async () => {
    const bad = [...parsed, { vicariate: 'NUEVA', sourceName: 'X', name: 'X' }];
    await expect(applyImport(db.prisma, GUAYAQUIL_SLUG, bad)).rejects.toThrow('Unknown vicariate');
    expect(await db.prisma.parish.count()).toBe(0);
  });
});
