import type { PublicVicariate } from '@parishmap/shared';

/** Lowercases and removes accents, so "jesus" finds "Jesús". */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keeps parishes whose name contains every word searched for, and drops empty vicariates. */
export function filterVicariates(vicariates: PublicVicariate[], query: string): PublicVicariate[] {
  const words = normalizeForSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return vicariates;

  return vicariates
    .map((vicariate) => ({
      ...vicariate,
      parishes: vicariate.parishes.filter((parish) => {
        const name = normalizeForSearch(parish.name);
        return words.every((word) => name.includes(word));
      }),
    }))
    .filter((vicariate) => vicariate.parishes.length > 0);
}
