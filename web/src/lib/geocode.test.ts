import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatLabel, GeocodeError, searchAddresses, searchUrl } from './geocode';

const GUAYAQUIL: [[number, number], [number, number]] = [
  [-79.98, -2.26],
  [-79.82, -2.1],
];

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('formatLabel', () => {
  it('joins name, street with number, district, and city', () => {
    expect(
      formatLabel({
        name: 'Mall del Sol',
        street: 'Av. Juan Tanca Marengo',
        housenumber: '100',
        district: 'Kennedy',
        city: 'Guayaquil',
      }),
    ).toBe('Mall del Sol, Av. Juan Tanca Marengo 100, Kennedy, Guayaquil');
  });

  it('skips missing parts and repeats, ignoring case', () => {
    expect(
      formatLabel({
        name: 'Avenida 9 de Octubre',
        street: 'avenida 9 de octubre',
        city: 'Guayaquil',
      }),
    ).toBe('Avenida 9 de Octubre, Guayaquil');
    expect(formatLabel({})).toBe('');
  });

  it('uses the locality when there is no district', () => {
    expect(formatLabel({ name: 'Parque', locality: 'Urdesa', city: 'Guayaquil' })).toBe(
      'Parque, Urdesa, Guayaquil',
    );
  });
});

describe('searchUrl', () => {
  it('limits results to the diocese area with a margin, and ranks by its center', () => {
    const url = new URL(searchUrl(' malecón ', GUAYAQUIL));
    expect(url.origin + url.pathname).toBe('https://photon.komoot.io/api/');
    expect(url.searchParams.get('q')).toBe('malecón');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('bbox')).toBe('-80.0300,-2.3100,-79.7700,-2.0500');
    expect(url.searchParams.get('lat')).toBe('-2.1800');
    expect(url.searchParams.get('lon')).toBe('-79.9000');
  });

  it('searches everywhere when the area is unknown', () => {
    const url = new URL(searchUrl('malecón', null));
    expect(url.searchParams.has('bbox')).toBe(false);
  });
});

describe('searchAddresses', () => {
  it('reads points, skipping other geometry, unnamed places, and duplicates', async () => {
    const point = (lng: number, lat: number) => ({ type: 'Point', coordinates: [lng, lat] });
    stubFetch(200, {
      type: 'FeatureCollection',
      features: [
        {
          geometry: point(-79.88, -2.19),
          properties: { osm_type: 'W', osm_id: 1, name: 'Malecón 2000', city: 'Guayaquil' },
        },
        {
          geometry: point(-79.88, -2.19),
          properties: { osm_type: 'W', osm_id: 1, name: 'Malecón 2000' },
        },
        { geometry: { type: 'LineString', coordinates: [] }, properties: { name: 'Línea' } },
        { geometry: point(-79.9, -2.2), properties: {} },
        {
          geometry: point(-79.89, -2.18),
          properties: { osm_type: 'N', osm_id: 2, name: 'Malecón del Salado' },
        },
      ],
    });

    expect(await searchAddresses('malecon', GUAYAQUIL)).toEqual([
      { id: 'W1', label: 'Malecón 2000, Guayaquil', lng: -79.88, lat: -2.19 },
      { id: 'N2', label: 'Malecón del Salado', lng: -79.89, lat: -2.18 },
    ]);
  });

  it('throws a GeocodeError when the service fails', async () => {
    stubFetch(500, {});
    await expect(searchAddresses('malecon', GUAYAQUIL)).rejects.toBeInstanceOf(GeocodeError);
  });
});
