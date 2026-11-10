import type { PublicTerritoryCollection } from '@parishmap/shared';
import { parishAtPoint } from '@parishmap/shared/geometry';
import type { MultiPolygon, Position } from 'geojson';
import { describe, expect, it } from 'vitest';
import { pointInMultiPolygon, territoryAt } from './point-in-area';

/** Same layout as the shared parishAtPoint tests. 0.01 degrees is roughly 1.1 km. */
const LNG = -79.9;
const LAT = -2.2;

function ring(west: number, south: number, east: number, north: number): Position[] {
  return [
    [LNG + west, LAT + south],
    [LNG + east, LAT + south],
    [LNG + east, LAT + north],
    [LNG + west, LAT + north],
    [LNG + west, LAT + south],
  ];
}

const donut: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [[ring(0, 0, 0.03, 0.03), ring(0.01, 0.01, 0.02, 0.02)]],
};
const split: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [[ring(0.05, 0, 0.06, 0.01)], [ring(0.08, 0, 0.09, 0.01)]],
};
const triangle: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [LNG, LAT],
        [LNG + 0.04, LAT + 0.05],
        [LNG - 0.03, LAT + 0.06],
        [LNG, LAT],
      ],
    ],
  ],
};

function collection(...shapes: [string, MultiPolygon][]): PublicTerritoryCollection {
  return {
    type: 'FeatureCollection',
    features: shapes.map(([slug, geometry]) => ({
      type: 'Feature',
      geometry,
      properties: { slug, name: slug, confidence: 'APPROXIMATE' },
    })),
  };
}

const territories = collection(['donut', donut], ['split', split]);
const slugAt = (lng: number, lat: number) => territoryAt(lng, lat, territories)?.properties.slug;

describe('pointInMultiPolygon', () => {
  it('is true inside and false outside', () => {
    expect(pointInMultiPolygon(LNG + 0.005, LAT + 0.005, donut)).toBe(true);
    expect(pointInMultiPolygon(LNG - 0.005, LAT + 0.005, donut)).toBe(false);
  });

  it('is false inside a hole', () => {
    expect(pointInMultiPolygon(LNG + 0.015, LAT + 0.015, donut)).toBe(false);
  });
});

describe('territoryAt', () => {
  it('finds the containing territory', () => {
    expect(slugAt(LNG + 0.005, LAT + 0.005)).toBe('donut');
  });

  it('checks every part of a multi-part territory', () => {
    expect(slugAt(LNG + 0.085, LAT + 0.005)).toBe('split');
  });

  it('returns null inside a hole, between parts, and far away', () => {
    expect(territoryAt(LNG + 0.015, LAT + 0.015, territories)).toBeNull();
    expect(territoryAt(LNG + 0.07, LAT + 0.005, territories)).toBeNull();
    expect(territoryAt(LNG + 1, LAT + 1, territories)).toBeNull();
  });

  it('returns null when nothing is published', () => {
    expect(territoryAt(LNG, LAT, collection())).toBeNull();
  });

  it('agrees with the shared Turf-based check on a grid of points', () => {
    const shapes = collection(['donut', donut], ['split', split], ['triangle', triangle]);
    const areas = shapes.features.map((f) => ({ id: f.properties.slug, geometry: f.geometry }));
    for (let x = -0.04; x <= 0.1; x += 0.0037) {
      for (let y = -0.01; y <= 0.07; y += 0.0041) {
        const expected = parishAtPoint(LNG + x, LAT + y, areas);
        expect(territoryAt(LNG + x, LAT + y, shapes)?.properties.slug ?? null).toBe(expected);
      }
    }
  });
});
