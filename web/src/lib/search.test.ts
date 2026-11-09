import type { PublicParish, PublicVicariate } from '@parishmap/shared';
import { describe, expect, it } from 'vitest';
import { filterVicariates, normalizeForSearch } from './search';

function vicariate(name: string, ...parishNames: string[]): PublicVicariate {
  return {
    name,
    parishes: parishNames.map((parishName) => ({ name: parishName }) as PublicParish),
  };
}

const data = [
  vicariate('Centro', 'Jesús Obrero', 'San Agustín'),
  vicariate('Sur', 'Santa Ana', 'Ángel de la Guarda'),
];

const names = (result: PublicVicariate[]) => result.flatMap((v) => v.parishes.map((p) => p.name));

describe('normalizeForSearch', () => {
  it('removes accents, case, and extra spaces', () => {
    expect(normalizeForSearch('  JESÚS   Obrero ')).toBe('jesus obrero');
  });

  it('removes the accent from ñ, so "senor" finds "Señor"', () => {
    expect(normalizeForSearch('Señor')).toBe('senor');
  });
});

describe('filterVicariates', () => {
  it('returns everything for an empty search', () => {
    expect(filterVicariates(data, '   ')).toEqual(data);
  });

  it('ignores accents in both directions', () => {
    expect(names(filterVicariates(data, 'jesus'))).toEqual(['Jesús Obrero']);
    expect(names(filterVicariates(data, 'ÁNGEL'))).toEqual(['Ángel de la Guarda']);
    expect(names(filterVicariates(data, 'agustín'))).toEqual(['San Agustín']);
  });

  it('matches words in any order', () => {
    expect(names(filterVicariates(data, 'obrero jesus'))).toEqual(['Jesús Obrero']);
  });

  it('drops vicariates with no matches', () => {
    expect(filterVicariates(data, 'santa ana').map((v) => v.name)).toEqual(['Sur']);
  });

  it('returns nothing when no parish matches', () => {
    expect(filterVicariates(data, 'zzz')).toEqual([]);
  });
});
