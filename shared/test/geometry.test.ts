import { area } from '@turf/turf';
import type { MultiPolygon, Polygon, Position } from 'geojson';
import { describe, expect, it } from 'vitest';
import {
  bboxOf,
  findCoverageGaps,
  findOutsideDiocese,
  findOverlaps,
  joinHoles,
  normalize,
  parishAtPoint,
  parseAreaGeometry,
  splitHoles,
  trimToNeighbors,
  validate,
} from '../src/geometry';

/** Test shapes sit near Guayaquil. 0.01 degrees is roughly 1.1 km. */
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

function box(west: number, south: number, east: number, north: number): MultiPolygon {
  return normalize({ type: 'Polygon', coordinates: [ring(west, south, east, north)] });
}

function multi(...parts: MultiPolygon[]): MultiPolygon {
  return { type: 'MultiPolygon', coordinates: parts.flatMap((part) => part.coordinates) };
}

function withHole(outer: Position[], hole: Position[]): MultiPolygon {
  return normalize({ type: 'Polygon', coordinates: [outer, hole] });
}

describe('normalize', () => {
  it('converts a Polygon to a MultiPolygon', () => {
    const result = normalize({ type: 'Polygon', coordinates: [ring(0, 0, 0.01, 0.01)] });
    expect(result.type).toBe('MultiPolygon');
    expect(result.coordinates).toHaveLength(1);
  });

  it('rounds coordinates to 6 decimals', () => {
    const polygon: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [-79.12345678, -2.12345678],
          [-79.1, -2.1],
          [-79.2, -2.1],
          [-79.12345678, -2.12345678],
        ],
      ],
    };
    expect(normalize(polygon).coordinates[0]![0]![0]).toEqual([-79.123457, -2.123457]);
  });

  it('closes open rings and removes repeated points', () => {
    const polygon: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [LNG, LAT],
          [LNG, LAT],
          [LNG + 0.01, LAT],
          [LNG + 0.01, LAT + 0.01],
        ],
      ],
    };
    const result = normalize(polygon).coordinates[0]![0]!;
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual(result[3]);
  });
});

describe('validate', () => {
  it('accepts simple, multi-part, and with-hole shapes', () => {
    expect(validate(box(0, 0, 0.01, 0.01))).toEqual([]);
    expect(validate(multi(box(0, 0, 0.01, 0.01), box(0.02, 0, 0.03, 0.01)))).toEqual([]);
    expect(validate(withHole(ring(0, 0, 0.03, 0.03), ring(0.01, 0.01, 0.02, 0.02)))).toEqual([]);
  });

  it('rejects empty shapes', () => {
    expect(validate({ type: 'MultiPolygon', coordinates: [] })).toEqual(['empty']);
  });

  it('rejects coordinates that are out of range', () => {
    const bad = normalize({
      type: 'Polygon',
      coordinates: [
        [
          [200, 0],
          [201, 0],
          [201, 1],
          [200, 0],
        ],
      ],
    });
    expect(validate(bad)).toEqual(['coordinates-out-of-range']);
  });

  it('rejects rings with too few points', () => {
    const bad = normalize({
      type: 'Polygon',
      coordinates: [
        [
          [LNG, LAT],
          [LNG + 0.01, LAT],
        ],
      ],
    });
    expect(validate(bad)).toEqual(['too-few-points']);
  });

  it('rejects self-intersecting shapes', () => {
    const bowtie = normalize({
      type: 'Polygon',
      coordinates: [
        [
          [LNG, LAT],
          [LNG + 0.01, LAT + 0.01],
          [LNG + 0.01, LAT],
          [LNG, LAT + 0.01],
          [LNG, LAT],
        ],
      ],
    });
    expect(validate(bowtie)).toContain('self-intersection');
  });

  it('rejects a hole outside its shell', () => {
    const bad = withHole(ring(0, 0, 0.01, 0.01), ring(0.05, 0.05, 0.06, 0.06));
    expect(validate(bad)).toContain('hole-outside-shell');
  });

  it('rejects parts that overlap each other', () => {
    const bad = multi(box(0, 0, 0.02, 0.02), box(0.01, 0.01, 0.03, 0.03));
    expect(validate(bad)).toContain('overlapping-parts');
  });
});

describe('findOverlaps', () => {
  const shape = box(0, 0, 0.02, 0.02);

  it('reports nothing for separate shapes', () => {
    expect(findOverlaps(shape, [{ id: 1, geometry: box(0.05, 0.05, 0.06, 0.06) }])).toEqual([]);
  });

  it('reports nothing for adjacent shapes sharing an edge', () => {
    expect(findOverlaps(shape, [{ id: 1, geometry: box(0.02, 0, 0.04, 0.02) }])).toEqual([]);
  });

  it('reports overlapping shapes with their shared area', () => {
    const [overlap, ...rest] = findOverlaps(shape, [{ id: 7, geometry: box(0.01, 0, 0.03, 0.02) }]);
    expect(rest).toEqual([]);
    expect(overlap?.id).toBe(7);
    expect(overlap?.areaM2).toBeCloseTo(area(box(0.01, 0, 0.02, 0.02)), -3);
  });

  it('reports a shape contained in another', () => {
    const inner = box(0.005, 0.005, 0.01, 0.01);
    const [overlap] = findOverlaps(shape, [{ id: 1, geometry: inner }]);
    expect(overlap?.areaM2).toBeCloseTo(area(inner), -2);
  });

  it('checks every part of a multi-part shape', () => {
    const parts = multi(box(0, 0, 0.01, 0.01), box(0.05, 0.05, 0.06, 0.06));
    const result = findOverlaps(parts, [{ id: 1, geometry: box(0.055, 0.055, 0.07, 0.07) }]);
    expect(result.map((overlap) => overlap.id)).toEqual([1]);
  });

  it('ignores a shape sitting inside another shape’s hole', () => {
    const donut = withHole(ring(0, 0, 0.03, 0.03), ring(0.01, 0.01, 0.02, 0.02));
    expect(findOverlaps(box(0.01, 0.01, 0.02, 0.02), [{ id: 1, geometry: donut }])).toEqual([]);
  });

  it('ignores a long thin sliver but reports a real overlap of the same area', () => {
    // About 4.4 km long and 0.11 m wide: rounding noise, despite an area near 490 m².
    const sliver = box(0.02 - 0.000001, 0, 0.06, 0.04);
    const longShape = box(0, 0, 0.02, 0.04);
    expect(findOverlaps(longShape, [{ id: 1, geometry: sliver }])).toEqual([]);

    // About 22 m by 22 m: a similar area, but clearly deliberate.
    const corner = box(0.02 - 0.0002, 0.04 - 0.0002, 0.03, 0.05);
    expect(findOverlaps(longShape, [{ id: 2, geometry: corner }])).toHaveLength(1);
  });
});

describe('trimToNeighbors', () => {
  it('returns the shape unchanged when nothing is nearby', () => {
    const shape = box(0, 0, 0.01, 0.01);
    expect(trimToNeighbors(shape, [box(0.5, 0.5, 0.6, 0.6)])).toEqual(shape);
  });

  it('cuts an overlap away, leaving no overlap with the neighbor', () => {
    const neighbor = box(0.02, 0, 0.04, 0.02);
    const trimmed = trimToNeighbors(box(0, 0, 0.025, 0.02), [neighbor])!;

    expect(validate(trimmed)).toEqual([]);
    expect(bboxOf(trimmed)[2]).toBeCloseTo(LNG + 0.02, 6);
    expect(findOverlaps(trimmed, [{ id: 1, geometry: neighbor }])).toEqual([]);
  });

  it('leaves no overlap along diagonal edges with imprecise coordinates', () => {
    const neighbor = normalize({
      type: 'Polygon',
      coordinates: [
        [
          [LNG + 0.0123457, LAT + 0.0011111],
          [LNG + 0.0587653, LAT + 0.0433333],
          [LNG + 0.0912347, LAT + 0.0077777],
          [LNG + 0.0123457, LAT + 0.0011111],
        ],
      ],
    });
    const trimmed = trimToNeighbors(box(0, 0, 0.06, 0.06), [neighbor])!;

    expect(validate(trimmed)).toEqual([]);
    expect(findOverlaps(trimmed, [{ id: 1, geometry: neighbor }])).toEqual([]);
  });

  it('trims against several neighbors at once', () => {
    const left = box(-0.01, 0, 0.005, 0.03);
    const right = box(0.025, 0, 0.04, 0.03);
    const trimmed = trimToNeighbors(box(0, 0, 0.03, 0.03), [left, right])!;

    const [west, , east] = bboxOf(trimmed);
    expect(west).toBeCloseTo(LNG + 0.005, 6);
    expect(east).toBeCloseTo(LNG + 0.025, 6);
  });

  it('returns several pieces when a neighbor splits the shape', () => {
    const trimmed = trimToNeighbors(box(0, 0, 0.03, 0.01), [box(0.01, -0.01, 0.02, 0.02)])!;
    expect(trimmed.coordinates).toHaveLength(2);
    expect(validate(trimmed)).toEqual([]);
  });

  it('creates a hole when a neighbor sits inside the shape', () => {
    const trimmed = trimToNeighbors(box(0, 0, 0.03, 0.03), [box(0.01, 0.01, 0.02, 0.02)])!;
    expect(trimmed.coordinates).toHaveLength(1);
    expect(trimmed.coordinates[0]).toHaveLength(2);
    expect(validate(trimmed)).toEqual([]);
  });

  it('returns null when nothing is left', () => {
    expect(trimToNeighbors(box(0.01, 0.01, 0.02, 0.02), [box(0, 0, 0.03, 0.03)])).toBeNull();
  });
});

describe('findOutsideDiocese', () => {
  const diocese = box(0, 0, 0.1, 0.1);

  it('returns null for a shape inside the diocese', () => {
    expect(findOutsideDiocese(box(0.01, 0.01, 0.02, 0.02), diocese)).toBeNull();
  });

  it('returns null for a shape sharing the diocese edge', () => {
    expect(findOutsideDiocese(box(0, 0, 0.02, 0.02), diocese)).toBeNull();
  });

  it('returns the part beyond the outline', () => {
    const outside = findOutsideDiocese(box(0.09, 0.01, 0.12, 0.02), diocese)!;
    expect(bboxOf(outside)[0]).toBeCloseTo(LNG + 0.1, 6);
    expect(bboxOf(outside)[2]).toBeCloseTo(LNG + 0.12, 6);
  });
});

describe('findCoverageGaps', () => {
  const diocese = box(0, 0, 0.04, 0.02);

  it('returns the whole diocese when no parish exists', () => {
    expect(findCoverageGaps(diocese, [])).toEqual(diocese);
  });

  it('returns null when parishes cover everything', () => {
    const west = box(0, 0, 0.02, 0.02);
    const east = box(0.02, 0, 0.04, 0.02);
    expect(findCoverageGaps(diocese, [west, east])).toBeNull();
  });

  it('works with a single parish', () => {
    const gap = findCoverageGaps(diocese, [box(0, 0, 0.02, 0.02)])!;
    expect(bboxOf(gap)[0]).toBeCloseTo(LNG + 0.02, 6);
  });

  it('returns uncovered areas between parishes', () => {
    const gap = findCoverageGaps(diocese, [box(0, 0, 0.01, 0.02), box(0.03, 0, 0.04, 0.02)])!;
    expect(gap.coordinates).toHaveLength(1);
    expect(bboxOf(gap)[0]).toBeCloseTo(LNG + 0.01, 6);
    expect(bboxOf(gap)[2]).toBeCloseTo(LNG + 0.03, 6);
  });
});

describe('parishAtPoint', () => {
  const areas = [
    { id: 'donut', geometry: withHole(ring(0, 0, 0.03, 0.03), ring(0.01, 0.01, 0.02, 0.02)) },
    { id: 'split', geometry: multi(box(0.05, 0, 0.06, 0.01), box(0.08, 0, 0.09, 0.01)) },
  ];

  it('finds the containing area', () => {
    expect(parishAtPoint(LNG + 0.005, LAT + 0.005, areas)).toBe('donut');
  });

  it('checks every part of a multi-part area', () => {
    expect(parishAtPoint(LNG + 0.085, LAT + 0.005, areas)).toBe('split');
  });

  it('returns null inside a hole, between parts, and outside', () => {
    expect(parishAtPoint(LNG + 0.015, LAT + 0.015, areas)).toBeNull();
    expect(parishAtPoint(LNG + 0.07, LAT + 0.005, areas)).toBeNull();
    expect(parishAtPoint(LNG + 1, LAT + 1, areas)).toBeNull();
  });
});

describe('parseAreaGeometry', () => {
  const polygon = { type: 'Polygon', coordinates: [ring(0, 0, 0.01, 0.01)] };

  it('reads each supported form', () => {
    expect(parseAreaGeometry(polygon)?.type).toBe('Polygon');
    expect(parseAreaGeometry(box(0, 0, 0.01, 0.01))?.type).toBe('MultiPolygon');
    expect(parseAreaGeometry({ type: 'Feature', properties: {}, geometry: polygon })?.type).toBe(
      'Polygon',
    );
  });

  it('combines the polygons in a FeatureCollection', () => {
    const result = parseAreaGeometry({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: polygon },
        { type: 'Feature', geometry: box(0.02, 0, 0.03, 0.01) },
      ],
    });
    expect(result?.type).toBe('MultiPolygon');
    expect(result?.coordinates).toHaveLength(2);
  });

  it('rejects other geometry and malformed input', () => {
    for (const bad of [
      null,
      'text',
      42,
      {},
      { type: 'Point', coordinates: [0, 0] },
      { type: 'Polygon' },
      { type: 'Polygon', coordinates: [[['a', 'b']]] },
      { type: 'Polygon', coordinates: [[[1]]] },
      { type: 'Polygon', coordinates: [[[Infinity, 0]]] },
      { type: 'FeatureCollection', features: [] },
    ]) {
      expect(parseAreaGeometry(bad)).toBeNull();
    }
  });

  it('rejects a whole file if any feature is not a polygon', () => {
    expect(
      parseAreaGeometry({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: polygon },
          { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } },
        ],
      }),
    ).toBeNull();
  });
});

describe('splitHoles and joinHoles', () => {
  const donut = withHole(ring(0, 0, 0.03, 0.03), ring(0.01, 0.01, 0.02, 0.02));

  it('round-trips a shape with a hole and several parts', () => {
    const shape = multi(donut, box(0.05, 0, 0.06, 0.01));
    const split = splitHoles(shape);
    expect(split.parts).toHaveLength(2);
    expect(split.holes).toHaveLength(1);

    const { geometry, droppedHoles } = joinHoles(split);
    expect(droppedHoles).toBe(0);
    expect(geometry).toEqual(shape);
  });

  it('attaches a hole to the part that contains it', () => {
    const shape = multi(box(0.05, 0, 0.06, 0.01), donut);
    const { geometry } = joinHoles(splitHoles(shape));
    expect(geometry.coordinates[0]).toHaveLength(1);
    expect(geometry.coordinates[1]).toHaveLength(2);
  });

  it('reports a hole left outside after editing, rather than losing it silently', () => {
    const { parts, holes } = splitHoles(donut);
    expect(parts).toHaveLength(1);
    const { geometry, droppedHoles } = joinHoles({ parts: [ring(0.5, 0.5, 0.6, 0.6)], holes });
    expect(droppedHoles).toBe(1);
    expect(geometry.coordinates[0]).toHaveLength(1);
  });

  it('gives a valid result after trimming creates a hole', () => {
    const trimmed = trimToNeighbors(box(0, 0, 0.03, 0.03), [box(0.01, 0.01, 0.02, 0.02)])!;
    const { geometry, droppedHoles } = joinHoles(splitHoles(trimmed));
    expect(droppedHoles).toBe(0);
    expect(validate(geometry)).toEqual([]);
    expect(geometry).toEqual(trimmed);
  });
});
