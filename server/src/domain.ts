export const CONFIDENCE_LEVELS = ['APPROXIMATE', 'CONFIRMED'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const VERSION_ACTIONS = ['SAVE', 'PUBLISH', 'RESTORE', 'IMPORT'] as const;
export type VersionAction = (typeof VERSION_ACTIONS)[number];

/** Builds a URL-safe slug: "Jesús Obrero" becomes "jesus-obrero". */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
