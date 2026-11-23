/** Used by both the server and the admin site, so a suggested slug is always one the server accepts. */

export const SLUG_MAX_LENGTH = 60;

/** Lowercase letters and digits, in groups joined by single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Diocese slugs share the site's top-level paths, so these would clash with existing pages. */
export const RESERVED_DIOCESE_SLUGS: readonly string[] = ['admin', 'api', 'assets'];

/** Builds a URL-safe slug: "Jesús Obrero" becomes "jesus-obrero". */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '');
}

export function isValidSlug(slug: string): boolean {
  return slug.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(slug);
}
