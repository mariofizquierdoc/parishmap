import type { ParsedParish } from './parse-guayaquil';

export interface ReviewNote {
  name: string;
  vicariate: string;
  reason: string;
}

/** Spellings seen on the source page that look wrong. Reported for review, never auto-corrected. */
const SUSPECT_SPELLINGS: [RegExp, string][] = [
  [/Buatismo/, 'possible typo of "Bautismo"'],
  [/Jésus/, 'possible typo of "Jesús"'],
  [/Señora de a /, 'possible typo of "de la"'],
  [/Ascención/, 'possible typo of "Ascensión"'],
  [/del Encarnación/, 'possible typo of "de la Encarnación"'],
];

function comparisonKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Flags entries a person should check. It doesn't change any data. */
export function reviewParishes(parishes: ParsedParish[]): ReviewNote[] {
  const notes: ReviewNote[] = [];
  const byKey = new Map<string, ParsedParish[]>();

  for (const parish of parishes) {
    const add = (reason: string) =>
      notes.push({ name: parish.name, vicariate: parish.vicariate, reason });

    for (const [pattern, reason] of SUSPECT_SPELLINGS) {
      if (pattern.test(parish.name)) add(reason);
    }
    if (/^(.{6,}?)\s+\1/.test(parish.name)) add('text appears to be repeated');
    if (parish.name !== parish.sourceName) add('extra spaces removed from the display name');
    if (/Iglesia Rectoral/i.test(parish.name)) add('rectoral church: may have no territory');

    const key = comparisonKey(parish.name);
    byKey.set(key, [...(byKey.get(key) ?? []), parish]);
  }

  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const places = group.map((parish) => parish.vicariate).join(', ');
    for (const parish of group) {
      notes.push({
        name: parish.name,
        vicariate: parish.vicariate,
        reason: `same name appears in: ${places}`,
      });
    }
  }

  return notes;
}
